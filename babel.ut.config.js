//let yinstrumenter = require('yinstrumenter');

let fs = require("fs");
let tsconf = eval(
  "(()=>(" + fs.readFileSync("tsconfig.json", "utf-8") + "))()"
);

let aliases = {};
for (let k in tsconf.compilerOptions.paths) {
  let v = tsconf.compilerOptions.paths[k];
  aliases[k] = "./" + v[0];
}

// console.log('tsconf = ',tsconf);
// console.log('aliases = ',aliases);
// process.exit(1);

module.exports = {
  presets: [
    //"@babel/preset-typescript",
    //"@babel/preset-react"
  ],
  plugins: [
    // Plugins for yinstr normalization
    // '@babel/transform-duplicate-keys',
    // '@babel/transform-function-name',
    // '@babel/transform-arrow-functions',
    // '@babel/transform-destructuring',
    // '@babel/transform-shorthand-properties',
    // '@babel/transform-member-expression-literals',
    // '@babel/transform-block-scoped-functions',
    // '@babel/transform-property-mutators',
    // Plugins for yinstr normalization END
    "@babel/syntax-typescript",
    "@babel/transform-typescript",
    "@babel/plugin-syntax-jsx",
    [
      "@babel/plugin-transform-react-jsx",
      {
        pragma: "React.createElement",
        pragmaFrag: "React.Fragment",
        throwIfNamespace: true,
        useBuiltIns: true
      }
    ],

    "@babel/plugin-transform-react-display-name",
    "@babel/plugin-transform-react-jsx-source",
    "@babel/plugin-transform-react-jsx-self",

    ["@babel/plugin-proposal-decorators", { legacy: true }],

    "@babel/proposal-optional-chaining",
    //        yinstrumenter,
    "@babel/proposal-class-properties",
    "@babel/proposal-object-rest-spread",
    [
      "module-resolver",
      {
        root: ["./"],
        alias: aliases
      }
    ],
    "@babel/transform-modules-commonjs"
  ]
};

module.exports = {
  presets: ["@babel/preset-typescript", "@babel/preset-react"],
  plugins: [
    ["@babel/plugin-proposal-decorators", { legacy: true }],
    "@babel/proposal-optional-chaining",
    ["@babel/proposal-class-properties", { legacy: true }],
    "@babel/proposal-object-rest-spread",
    [
      "module-resolver",
      {
        root: ["./"],
        alias: aliases
      }
    ],
    "@babel/transform-modules-commonjs"
  ]
};
