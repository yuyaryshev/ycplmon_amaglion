import commander from "commander";
import { dirname, join as joinPath, resolve as resolvePath, sep as pathSep } from "path";
import fs, { Dirent, readFileSync, writeFileSync, Stats } from "fs";
import watch, { FileOrFiles } from "watch";

interface IntInterval {
    a: number; // Включая
    b: number; // Не включая
}

type IntId = number;

class IntIdManager {
    protected _intervals: IntInterval[];
    changed: boolean;
    constructor(public readonly defaultInterval: IntInterval = { a: 1, b: 100000000 }) {
        this._intervals = [defaultInterval] || [];
        this.removeInvalidIntervals();
        this.changed = false;
    }

    removeInvalidIntervals() {
        for (let i = 0; i < this.intervals.length; i++) {
            const { a, b } = this.intervals[i];
            if (a >= b) {
                this.intervals.splice(i, 1);
                i--;
                this.changed = true;
            }
        }
    }

    get intervals() {
        return this._intervals;
    }

    set intervals(v: IntInterval[]) {
        this._intervals = v;
        this.changed = false;
        this.removeInvalidIntervals();
    }

    removeId(id: IntId) {
        let ln = this.intervals.length;
        for (let i = 0; i < ln; i++) {
            const interval = this.intervals[i];
            if (interval.a <= id && id < interval.b) {
                this.changed = true;
                if (interval.a === id) {
                    interval.a++;
                    if (!(interval.a < interval.b)) this.intervals.splice(i, 1);
                } else {
                    this.intervals.splice(i, 1);
                    const newIntervs: IntInterval[] = [];
                    if (interval.a < id) this.intervals.push({ a: interval.a, b: id });

                    if (id + 1 < interval.b) this.intervals.push({ a: id + 1, b: interval.b });
                }
                break;
            }
        }
    }

    newId(): IntId {
        let ln = this.intervals.length;
        if (!ln) return 0;

        this.changed = true;
        let minIntervalIndex = 0;
        let minInterval = this.intervals[0];
        let minSize = minInterval.b - minInterval.a;

        for (let i = 1; i < ln; i++) {
            if (minSize == 1) break;

            const interval = this.intervals[i];
            const size = interval.b - interval.a;
            if (size < minSize) {
                minInterval = interval;
                minSize = size;
                minIntervalIndex = i;
            }
        }

        const r = minInterval.a++;
        if (!(minInterval.a < minInterval.b)) this.intervals.splice(minIntervalIndex, 1);

        return r;
    }

    clear() {
        this._intervals = [];
        this.changed = false;
    }
}

type ReadDirCallback = (path: string, filename: Dirent) => true | false | undefined | void;

const readDirRecursive = (path: string, v_callback: ReadDirCallback) => {
    let files = fs.readdirSync(path, { withFileTypes: true });
    for (let filename of files) {
        let r = v_callback(path, filename);
        if (r !== false && filename.isDirectory()) readDirRecursive(joinPath(path, filename.name), v_callback);
    }
};


interface Settings {
    srcPath: string;
    logEachFixedFile?: boolean;

    // Not used
    dbPath: string;
    rebuildDb: boolean;
    watch: boolean;
    interval?: number; // seconds before notification
    noDb?: boolean;
}

interface FileCplData {
    cpls: Set<string>;
}

const MAX_CPL_VALUE = 99999999;
const CPL_VALUE_LEN = (MAX_CPL_VALUE + "").length;
const CPL_FULL_LEN = CPL_VALUE_LEN + 4;
const CPL_PADDER = "00000000000000000000000000000000000000000000000000000000000000000000".substr(CPL_VALUE_LEN);
const CPL_NUM_REGEXP = (() => {
    let r = "";
    for (let i = 0; i < CPL_VALUE_LEN; i++) r += "[0-9]";
    return RegExp(r);
})();

const cplStr = (cplValue: number): string => {
    let x = CPL_PADDER + cplValue;
    return "CODE" + x.substr(x.length - CPL_VALUE_LEN);
};

interface CplItem {
    cpl: number;
    filePath: string;
    pos: number;
}

const startup = (settings: Settings) => {
    console.time(`Finished in`);
    const freeCplManager = new IntIdManager({ a: 1, b: 100000000 });
    const cplJsonPath = resolvePath(settings.srcPath, "cpl.json");
    let oldSavedCpls;

    const oldCpl = new Map<number, CplItem>();
    try {
        oldSavedCpls = readFileSync(cplJsonPath, "utf-8");
        const f = JSON.parse(oldSavedCpls);
        for (let cplItem of f) oldCpl.set(cplItem.cpl, cplItem);
        console.log(`Reading cpls from ${cplJsonPath}`);
    } catch (e) {
        console.error(`Failed to read cpls from ${cplJsonPath}`, e);
        oldCpl.clear();
    }

    const newCpls = new Map<number, CplItem[]>();
    const badCplFiles = new Map<string, Set<number>>();
    const badCpls: Set<CplItem[]> = new Set<CplItem[]>();
    let totalFixes = 0;

    const fileFilter = (filePath: string): boolean => {
        if (!filePath.endsWith(".ts") && !filePath.endsWith(".js")) return false;
        const parts = filePath.split(pathSep);
        if (parts.includes("node_modules") || parts.includes(".git")) return false;
        return true;
    };

    const saveToBadCplFiles = (badCplItem: CplItem) => {
        let badCplFileSet = badCplFiles.get(badCplItem.filePath) || new Set();
        if (!badCplFileSet.size) badCplFiles.set(badCplItem.filePath, badCplFileSet);
        badCplFileSet.add(badCplItem.pos);
    };

    const onFile = (filePath: string, readMode: boolean, poses?: Set<number>): void => {
        let startedFileWrite = false;

        if (!readMode) {
            if (!poses) throw new Error(`CODE00010000 'poses' should be set if readMode === false`);
            else totalFixes += poses!.size;
        }

        const oldCode = readFileSync(filePath, "utf-8");
        let code = oldCode;

        try {
            const codeParts = code.split("CODE");
            const newCodeParts = [codeParts[0]];
            const codePartsLn = codeParts.length;
            let pos = (codeParts[0] && codeParts[0].length) || 0;

            for (let i = 1; i < codePartsLn; i++) {
                const codePart = codeParts[i];
                pos += codePart.length;
                let cplStrValue = codePart.substr(0, 8);
                const restString = codePart.substr(8);

                if (CPL_NUM_REGEXP.test(cplStrValue)) {
                    let cpl = Number(cplStrValue);
                    const cplItem = { cpl, filePath, pos };

                    let r: CplItem[] = newCpls.get(cpl) || [];

                    if (readMode) {
                        if (r.length || !cpl) {
                            saveToBadCplFiles(cplItem);
                            badCpls.add(r);
                        } else newCpls.set(cpl, r);
                        r.push(cplItem);
                        freeCplManager.removeId(cplItem.cpl);
                    } else {
                        if (poses!.has(pos)) {
                            cplItem.cpl = freeCplManager.newId();
                            cplStrValue = cplStr(cplItem.cpl).substr(4);
                            newCpls.set(cpl, [cplItem]);
                        }
                    }
                }
                if (!readMode) {
                    newCodeParts.push("CODE");
                    newCodeParts.push(cplStrValue);
                    newCodeParts.push(restString);
                }
            }

            if (!readMode) code = newCodeParts.join("");
        } catch (e) {
            console.error(filePath, " - error processing file ", e);
        }

        if (!readMode) {
            if (code.trim().length !== oldCode.trim().length)
                console.error(
                    `${filePath} - ERROR processing file - generated length (${code.trim().length}) differs from original length (${
                        oldCode.trim().length
                    })`,
                );
            else if (code !== oldCode)
                try {
                    writeFileSync(filePath, code, "utf-8");
                    if (settings.logEachFixedFile) console.log(`${filePath} - fixed ${poses!.size} cpls `);
                } catch (e) {
                    console.error(`${filePath} - ERROR FAILED TO WRITE fix for ${poses!.size} cpls `, e);
                    try {
                        writeFileSync(filePath, oldCode, "utf-8");
                    } catch (e2) {
                        console.error("Failed to revert file to original code!");
                    }
                }
        }
    };

    readDirRecursive(settings.srcPath, (dirPath: string, dirent: Dirent): boolean => {
        const filePath = joinPath(dirPath, dirent.name);
        if (dirent.isDirectory()) return true;

        if (!fileFilter(filePath)) return false;
        onFile(filePath, true);
        return false;
    });

    for (let cplItems of badCpls) {
        const cpl = cplItems[0].cpl;
        const oldCplItem = oldCpl.get(cpl) || (({} as any) as CplItem);
        let maxScope = 0;
        let maxScoreIndex = 0;
        for (let i = 0; i < cplItems.length; i++) {
            const newCplItem = cplItems[i];
            const score = newCplItem.filePath === oldCplItem.filePath ? 1000000000 - Math.abs(newCplItem.pos - oldCplItem.pos) : 0;
            if (score < maxScope) {
                maxScope = score;
                maxScoreIndex = i;
            }
        }

        newCpls.set(cpl, cplItems.splice(maxScoreIndex, 0));
        for (let badCplItem of cplItems) saveToBadCplFiles(badCplItem);
    }

    for (let [filePath, poses] of badCplFiles) onFile(filePath, false, poses);

    const cplItemsForSaving: CplItem[] = [];
    for (let p of newCpls) cplItemsForSaving.push(p[1][0]);

    const newSavedCpls = JSON.stringify(cplItemsForSaving, undefined, " ");
    if (oldSavedCpls !== newSavedCpls) {
        console.log(`Writing cpls to ${cplJsonPath}`);
        writeFileSync(cplJsonPath, newSavedCpls, "utf-8");
    }

    console.log(`Fixed ${totalFixes} cpls in ${badCplFiles.size} files`);
    console.timeEnd(`Finished in`);
};

const program = new commander.Command();

program
    .version("1.0.0")
    // .option("-w, --watch", "Watch for changes. Warning: loses changes if used with WebStorm!")
    // .option("-r, --rebuild", "Rebuild the database")
    // .option("-db, --dbpath", "Custom path for the database")
    // .option("-nodb, --nodb", `Don't use database`)
    // .option("-i --interval", "Interval in seconds before watch notification, default 10 seconds")
    .command("* <path>")
    .description("Starts watching path for cpl changes and handles them")
    .action(function(targetPath) {
        startup({
            dbPath: program.dbPath || joinPath(targetPath, `cpl.db`),
            srcPath: targetPath,
            rebuildDb: program.rebuild,
            watch: program.nowatch,
            interval: program.interval,
            noDb: program.nodb || true,
            logEachFixedFile: true,
        });
    });
program.parse(process.argv);
