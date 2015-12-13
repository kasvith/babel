import deepClone from "lodash/cloneDeep";
import sourceMapSupport from "source-map-support";
import * as registerCache from "./cache";
import escapeRegExp from "lodash/escapeRegExp";
import * as babel from "babel-core";
import { OptionManager, DEFAULT_EXTENSIONS } from "babel-core";
import { addHook } from "pirates";
import fs from "fs";
import path from "path";

const maps = {};
const transformOpts = {};
let revert = null;

sourceMapSupport.install({
  handleUncaughtExceptions: false,
  environment: "node",
  retrieveSourceMap(source) {
    const map = maps && maps[source];
    if (map) {
      return {
        url: null,
        map: map,
      };
    } else {
      return null;
    }
  },
});

registerCache.load();
let cache = registerCache.get();

function mtime(filename) {
  return +fs.statSync(filename).mtime;
}

function compile(code, filename) {
  let result;

  // merge in base options and resolve all the plugins and presets relative to this file
  const opts = new OptionManager().init(Object.assign(
    { sourceRoot: path.dirname(filename) }, // sourceRoot can be overwritten
    deepClone(transformOpts),
    { filename }
  ));

  // Bail out ASAP if the file has been ignored.
  if (opts === null) return null;

  let cacheKey = `${JSON.stringify(opts)}:${babel.version}`;

  const env = babel.getEnv(false);

  if (env) cacheKey += `:${env}`;

  if (cache) {
    const cached = cache[cacheKey];
    if (cached && cached.mtime === mtime(filename)) {
      result = cached;
    }
  }

  if (!result) {
    result = babel.transform(code, Object.assign(opts, {
      // Do not process config files since has already been done with the OptionManager
      // calls above and would introduce duplicates.
      babelrc: false,
      sourceMaps: "both",
      ast: false,
    }));
  }

  if (cache) {
    cache[cacheKey] = result;
    result.mtime = mtime(filename);
  }

  maps[filename] = result.map;

  return result.code;
}

function hookExtensions(exts) {
  if (revert) revert();
  revert = addHook(compile, { exts, ignoreNodeModules: false });
}

register({
  extensions: DEFAULT_EXTENSIONS,
});

export default function register(opts?: Object = {}) {
  if (opts.extensions) hookExtensions(opts.extensions);

  if (opts.cache === false) cache = null;

  delete opts.extensions;
  delete opts.cache;

  Object.assign(transformOpts, opts);

  if (!transformOpts.ignore && !transformOpts.only) {
    // By default, ignore files inside the node_modules relative to the current working directory.
    transformOpts.ignore = [
      new RegExp(
        "^" +
        escapeRegExp(process.cwd()) +
        "(?:" + path.sep + ".*)?" +
        escapeRegExp(path.sep + "node_modules" + path.sep)
      , "i"),
    ];
  }
}
