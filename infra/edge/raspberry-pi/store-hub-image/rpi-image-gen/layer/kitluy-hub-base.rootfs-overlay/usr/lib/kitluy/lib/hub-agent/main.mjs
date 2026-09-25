#!/usr/bin/env node
import { createRequire as __kitluyCreateRequire } from 'node:module';
const require = __kitluyCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/postgres-array@2.0.0/node_modules/postgres-array/index.js
var require_postgres_array = __commonJS({
  "../../node_modules/.pnpm/postgres-array@2.0.0/node_modules/postgres-array/index.js"(exports) {
    "use strict";
    exports.parse = function(source, transform) {
      return new ArrayParser(source, transform).parse();
    };
    var ArrayParser = class _ArrayParser {
      constructor(source, transform) {
        this.source = source;
        this.transform = transform || identity;
        this.position = 0;
        this.entries = [];
        this.recorded = [];
        this.dimension = 0;
      }
      isEof() {
        return this.position >= this.source.length;
      }
      nextCharacter() {
        var character = this.source[this.position++];
        if (character === "\\") {
          return {
            value: this.source[this.position++],
            escaped: true
          };
        }
        return {
          value: character,
          escaped: false
        };
      }
      record(character) {
        this.recorded.push(character);
      }
      newEntry(includeEmpty) {
        var entry;
        if (this.recorded.length > 0 || includeEmpty) {
          entry = this.recorded.join("");
          if (entry === "NULL" && !includeEmpty) {
            entry = null;
          }
          if (entry !== null) entry = this.transform(entry);
          this.entries.push(entry);
          this.recorded = [];
        }
      }
      consumeDimensions() {
        if (this.source[0] === "[") {
          while (!this.isEof()) {
            var char = this.nextCharacter();
            if (char.value === "=") break;
          }
        }
      }
      parse(nested) {
        var character, parser, quote;
        this.consumeDimensions();
        while (!this.isEof()) {
          character = this.nextCharacter();
          if (character.value === "{" && !quote) {
            this.dimension++;
            if (this.dimension > 1) {
              parser = new _ArrayParser(this.source.substr(this.position - 1), this.transform);
              this.entries.push(parser.parse(true));
              this.position += parser.position - 2;
            }
          } else if (character.value === "}" && !quote) {
            this.dimension--;
            if (!this.dimension) {
              this.newEntry();
              if (nested) return this.entries;
            }
          } else if (character.value === '"' && !character.escaped) {
            if (quote) this.newEntry(true);
            quote = !quote;
          } else if (character.value === "," && !quote) {
            this.newEntry();
          } else {
            this.record(character.value);
          }
        }
        if (this.dimension !== 0) {
          throw new Error("array dimension not balanced");
        }
        return this.entries;
      }
    };
    function identity(value) {
      return value;
    }
  }
});

// ../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/arrayParser.js
var require_arrayParser = __commonJS({
  "../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/arrayParser.js"(exports, module) {
    var array = require_postgres_array();
    module.exports = {
      create: function(source, transform) {
        return {
          parse: function() {
            return array.parse(source, transform);
          }
        };
      }
    };
  }
});

// ../../node_modules/.pnpm/postgres-date@1.0.7/node_modules/postgres-date/index.js
var require_postgres_date = __commonJS({
  "../../node_modules/.pnpm/postgres-date@1.0.7/node_modules/postgres-date/index.js"(exports, module) {
    "use strict";
    var DATE_TIME = /(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,})?.*?( BC)?$/;
    var DATE = /^(\d{1,})-(\d{2})-(\d{2})( BC)?$/;
    var TIME_ZONE = /([Z+-])(\d{2})?:?(\d{2})?:?(\d{2})?/;
    var INFINITY = /^-?infinity$/;
    module.exports = function parseDate(isoDate) {
      if (INFINITY.test(isoDate)) {
        return Number(isoDate.replace("i", "I"));
      }
      var matches = DATE_TIME.exec(isoDate);
      if (!matches) {
        return getDate(isoDate) || null;
      }
      var isBC = !!matches[8];
      var year = parseInt(matches[1], 10);
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches[2], 10) - 1;
      var day = matches[3];
      var hour = parseInt(matches[4], 10);
      var minute = parseInt(matches[5], 10);
      var second = parseInt(matches[6], 10);
      var ms = matches[7];
      ms = ms ? 1e3 * parseFloat(ms) : 0;
      var date;
      var offset = timeZoneOffset(isoDate);
      if (offset != null) {
        date = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
        if (is0To99(year)) {
          date.setUTCFullYear(year);
        }
        if (offset !== 0) {
          date.setTime(date.getTime() - offset);
        }
      } else {
        date = new Date(year, month, day, hour, minute, second, ms);
        if (is0To99(year)) {
          date.setFullYear(year);
        }
      }
      return date;
    };
    function getDate(isoDate) {
      var matches = DATE.exec(isoDate);
      if (!matches) {
        return;
      }
      var year = parseInt(matches[1], 10);
      var isBC = !!matches[4];
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches[2], 10) - 1;
      var day = matches[3];
      var date = new Date(year, month, day);
      if (is0To99(year)) {
        date.setFullYear(year);
      }
      return date;
    }
    function timeZoneOffset(isoDate) {
      if (isoDate.endsWith("+00")) {
        return 0;
      }
      var zone = TIME_ZONE.exec(isoDate.split(" ")[1]);
      if (!zone) return;
      var type = zone[1];
      if (type === "Z") {
        return 0;
      }
      var sign2 = type === "-" ? -1 : 1;
      var offset = parseInt(zone[2], 10) * 3600 + parseInt(zone[3] || 0, 10) * 60 + parseInt(zone[4] || 0, 10);
      return offset * sign2 * 1e3;
    }
    function bcYearToNegativeYear(year) {
      return -(year - 1);
    }
    function is0To99(num) {
      return num >= 0 && num < 100;
    }
  }
});

// ../../node_modules/.pnpm/xtend@4.0.2/node_modules/xtend/mutable.js
var require_mutable = __commonJS({
  "../../node_modules/.pnpm/xtend@4.0.2/node_modules/xtend/mutable.js"(exports, module) {
    module.exports = extend;
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    function extend(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
      return target;
    }
  }
});

// ../../node_modules/.pnpm/postgres-interval@1.2.0/node_modules/postgres-interval/index.js
var require_postgres_interval = __commonJS({
  "../../node_modules/.pnpm/postgres-interval@1.2.0/node_modules/postgres-interval/index.js"(exports, module) {
    "use strict";
    var extend = require_mutable();
    module.exports = PostgresInterval;
    function PostgresInterval(raw) {
      if (!(this instanceof PostgresInterval)) {
        return new PostgresInterval(raw);
      }
      extend(this, parse(raw));
    }
    var properties = ["seconds", "minutes", "hours", "days", "months", "years"];
    PostgresInterval.prototype.toPostgres = function() {
      var filtered = properties.filter(this.hasOwnProperty, this);
      if (this.milliseconds && filtered.indexOf("seconds") < 0) {
        filtered.push("seconds");
      }
      if (filtered.length === 0) return "0";
      return filtered.map(function(property) {
        var value = this[property] || 0;
        if (property === "seconds" && this.milliseconds) {
          value = (value + this.milliseconds / 1e3).toFixed(6).replace(/\.?0+$/, "");
        }
        return value + " " + property;
      }, this).join(" ");
    };
    var propertiesISOEquivalent = {
      years: "Y",
      months: "M",
      days: "D",
      hours: "H",
      minutes: "M",
      seconds: "S"
    };
    var dateProperties = ["years", "months", "days"];
    var timeProperties = ["hours", "minutes", "seconds"];
    PostgresInterval.prototype.toISOString = PostgresInterval.prototype.toISO = function() {
      var datePart = dateProperties.map(buildProperty, this).join("");
      var timePart = timeProperties.map(buildProperty, this).join("");
      return "P" + datePart + "T" + timePart;
      function buildProperty(property) {
        var value = this[property] || 0;
        if (property === "seconds" && this.milliseconds) {
          value = (value + this.milliseconds / 1e3).toFixed(6).replace(/0+$/, "");
        }
        return value + propertiesISOEquivalent[property];
      }
    };
    var NUMBER = "([+-]?\\d+)";
    var YEAR = NUMBER + "\\s+years?";
    var MONTH = NUMBER + "\\s+mons?";
    var DAY = NUMBER + "\\s+days?";
    var TIME = "([+-])?([\\d]*):(\\d\\d):(\\d\\d)\\.?(\\d{1,6})?";
    var INTERVAL = new RegExp([YEAR, MONTH, DAY, TIME].map(function(regexString) {
      return "(" + regexString + ")?";
    }).join("\\s*"));
    var positions = {
      years: 2,
      months: 4,
      days: 6,
      hours: 9,
      minutes: 10,
      seconds: 11,
      milliseconds: 12
    };
    var negatives = ["hours", "minutes", "seconds", "milliseconds"];
    function parseMilliseconds(fraction) {
      var microseconds = fraction + "000000".slice(fraction.length);
      return parseInt(microseconds, 10) / 1e3;
    }
    function parse(interval) {
      if (!interval) return {};
      var matches = INTERVAL.exec(interval);
      var isNegative2 = matches[8] === "-";
      return Object.keys(positions).reduce(function(parsed, property) {
        var position = positions[property];
        var value = matches[position];
        if (!value) return parsed;
        value = property === "milliseconds" ? parseMilliseconds(value) : parseInt(value, 10);
        if (!value) return parsed;
        if (isNegative2 && ~negatives.indexOf(property)) {
          value *= -1;
        }
        parsed[property] = value;
        return parsed;
      }, {});
    }
  }
});

// ../../node_modules/.pnpm/postgres-bytea@1.0.1/node_modules/postgres-bytea/index.js
var require_postgres_bytea = __commonJS({
  "../../node_modules/.pnpm/postgres-bytea@1.0.1/node_modules/postgres-bytea/index.js"(exports, module) {
    "use strict";
    var bufferFrom = Buffer.from || Buffer;
    module.exports = function parseBytea(input) {
      if (/^\\x/.test(input)) {
        return bufferFrom(input.substr(2), "hex");
      }
      var output = "";
      var i = 0;
      while (i < input.length) {
        if (input[i] !== "\\") {
          output += input[i];
          ++i;
        } else {
          if (/[0-7]{3}/.test(input.substr(i + 1, 3))) {
            output += String.fromCharCode(parseInt(input.substr(i + 1, 3), 8));
            i += 4;
          } else {
            var backslashes = 1;
            while (i + backslashes < input.length && input[i + backslashes] === "\\") {
              backslashes++;
            }
            for (var k = 0; k < Math.floor(backslashes / 2); ++k) {
              output += "\\";
            }
            i += Math.floor(backslashes / 2) * 2;
          }
        }
      }
      return bufferFrom(output, "binary");
    };
  }
});

// ../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/textParsers.js
var require_textParsers = __commonJS({
  "../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/textParsers.js"(exports, module) {
    var array = require_postgres_array();
    var arrayParser = require_arrayParser();
    var parseDate = require_postgres_date();
    var parseInterval = require_postgres_interval();
    var parseByteA = require_postgres_bytea();
    function allowNull(fn) {
      return function nullAllowed(value) {
        if (value === null) return value;
        return fn(value);
      };
    }
    function parseBool(value) {
      if (value === null) return value;
      return value === "TRUE" || value === "t" || value === "true" || value === "y" || value === "yes" || value === "on" || value === "1";
    }
    function parseBoolArray(value) {
      if (!value) return null;
      return array.parse(value, parseBool);
    }
    function parseBaseTenInt(string) {
      return parseInt(string, 10);
    }
    function parseIntegerArray(value) {
      if (!value) return null;
      return array.parse(value, allowNull(parseBaseTenInt));
    }
    function parseBigIntegerArray(value) {
      if (!value) return null;
      return array.parse(value, allowNull(function(entry) {
        return parseBigInteger(entry).trim();
      }));
    }
    var parsePointArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parsePoint(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseFloatArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseFloat(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseStringArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value);
      return p.parse();
    };
    var parseDateArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseDate(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseIntervalArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseInterval(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseByteAArray = function(value) {
      if (!value) {
        return null;
      }
      return array.parse(value, allowNull(parseByteA));
    };
    var parseInteger = function(value) {
      return parseInt(value, 10);
    };
    var parseBigInteger = function(value) {
      var valStr = String(value);
      if (/^\d+$/.test(valStr)) {
        return valStr;
      }
      return value;
    };
    var parseJsonArray = function(value) {
      if (!value) {
        return null;
      }
      return array.parse(value, allowNull(JSON.parse));
    };
    var parsePoint = function(value) {
      if (value[0] !== "(") {
        return null;
      }
      value = value.substring(1, value.length - 1).split(",");
      return {
        x: parseFloat(value[0]),
        y: parseFloat(value[1])
      };
    };
    var parseCircle = function(value) {
      if (value[0] !== "<" && value[1] !== "(") {
        return null;
      }
      var point = "(";
      var radius = "";
      var pointParsed = false;
      for (var i = 2; i < value.length - 1; i++) {
        if (!pointParsed) {
          point += value[i];
        }
        if (value[i] === ")") {
          pointParsed = true;
          continue;
        } else if (!pointParsed) {
          continue;
        }
        if (value[i] === ",") {
          continue;
        }
        radius += value[i];
      }
      var result = parsePoint(point);
      result.radius = parseFloat(radius);
      return result;
    };
    var init = function(register) {
      register(20, parseBigInteger);
      register(21, parseInteger);
      register(23, parseInteger);
      register(26, parseInteger);
      register(700, parseFloat);
      register(701, parseFloat);
      register(16, parseBool);
      register(1082, parseDate);
      register(1114, parseDate);
      register(1184, parseDate);
      register(600, parsePoint);
      register(651, parseStringArray);
      register(718, parseCircle);
      register(1e3, parseBoolArray);
      register(1001, parseByteAArray);
      register(1005, parseIntegerArray);
      register(1007, parseIntegerArray);
      register(1028, parseIntegerArray);
      register(1016, parseBigIntegerArray);
      register(1017, parsePointArray);
      register(1021, parseFloatArray);
      register(1022, parseFloatArray);
      register(1231, parseFloatArray);
      register(1014, parseStringArray);
      register(1015, parseStringArray);
      register(1008, parseStringArray);
      register(1009, parseStringArray);
      register(1040, parseStringArray);
      register(1041, parseStringArray);
      register(1115, parseDateArray);
      register(1182, parseDateArray);
      register(1185, parseDateArray);
      register(1186, parseInterval);
      register(1187, parseIntervalArray);
      register(17, parseByteA);
      register(114, JSON.parse.bind(JSON));
      register(3802, JSON.parse.bind(JSON));
      register(199, parseJsonArray);
      register(3807, parseJsonArray);
      register(3907, parseStringArray);
      register(2951, parseStringArray);
      register(791, parseStringArray);
      register(1183, parseStringArray);
      register(1270, parseStringArray);
    };
    module.exports = {
      init
    };
  }
});

// ../../node_modules/.pnpm/pg-int8@1.0.1/node_modules/pg-int8/index.js
var require_pg_int8 = __commonJS({
  "../../node_modules/.pnpm/pg-int8@1.0.1/node_modules/pg-int8/index.js"(exports, module) {
    "use strict";
    var BASE = 1e6;
    function readInt8(buffer) {
      var high = buffer.readInt32BE(0);
      var low = buffer.readUInt32BE(4);
      var sign2 = "";
      if (high < 0) {
        high = ~high + (low === 0);
        low = ~low + 1 >>> 0;
        sign2 = "-";
      }
      var result = "";
      var carry;
      var t;
      var digits;
      var pad;
      var l;
      var i;
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign2 + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign2 + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign2 + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        t = 4294967296 * carry + low;
        digits = "" + t % BASE;
        return sign2 + digits + result;
      }
    }
    module.exports = readInt8;
  }
});

// ../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/binaryParsers.js
var require_binaryParsers = __commonJS({
  "../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/binaryParsers.js"(exports, module) {
    var parseInt64 = require_pg_int8();
    var parseBits = function(data, bits, offset, invert, callback) {
      offset = offset || 0;
      invert = invert || false;
      callback = callback || function(lastValue, newValue, bits2) {
        return lastValue * Math.pow(2, bits2) + newValue;
      };
      var offsetBytes = offset >> 3;
      var inv = function(value) {
        if (invert) {
          return ~value & 255;
        }
        return value;
      };
      var mask = 255;
      var firstBits = 8 - offset % 8;
      if (bits < firstBits) {
        mask = 255 << 8 - bits & 255;
        firstBits = bits;
      }
      if (offset) {
        mask = mask >> offset % 8;
      }
      var result = 0;
      if (offset % 8 + bits >= 8) {
        result = callback(0, inv(data[offsetBytes]) & mask, firstBits);
      }
      var bytes = bits + offset >> 3;
      for (var i = offsetBytes + 1; i < bytes; i++) {
        result = callback(result, inv(data[i]), 8);
      }
      var lastBits = (bits + offset) % 8;
      if (lastBits > 0) {
        result = callback(result, inv(data[bytes]) >> 8 - lastBits, lastBits);
      }
      return result;
    };
    var parseFloatFromBits = function(data, precisionBits, exponentBits) {
      var bias = Math.pow(2, exponentBits - 1) - 1;
      var sign2 = parseBits(data, 1);
      var exponent = parseBits(data, exponentBits, 1);
      if (exponent === 0) {
        return 0;
      }
      var precisionBitsCounter = 1;
      var parsePrecisionBits = function(lastValue, newValue, bits) {
        if (lastValue === 0) {
          lastValue = 1;
        }
        for (var i = 1; i <= bits; i++) {
          precisionBitsCounter /= 2;
          if ((newValue & 1 << bits - i) > 0) {
            lastValue += precisionBitsCounter;
          }
        }
        return lastValue;
      };
      var mantissa = parseBits(data, precisionBits, exponentBits + 1, false, parsePrecisionBits);
      if (exponent == Math.pow(2, exponentBits + 1) - 1) {
        if (mantissa === 0) {
          return sign2 === 0 ? Infinity : -Infinity;
        }
        return NaN;
      }
      return (sign2 === 0 ? 1 : -1) * Math.pow(2, exponent - bias) * mantissa;
    };
    var parseInt16 = function(value) {
      if (parseBits(value, 1) == 1) {
        return -1 * (parseBits(value, 15, 1, true) + 1);
      }
      return parseBits(value, 15, 1);
    };
    var parseInt32 = function(value) {
      if (parseBits(value, 1) == 1) {
        return -1 * (parseBits(value, 31, 1, true) + 1);
      }
      return parseBits(value, 31, 1);
    };
    var parseFloat32 = function(value) {
      return parseFloatFromBits(value, 23, 8);
    };
    var parseFloat64 = function(value) {
      return parseFloatFromBits(value, 52, 11);
    };
    var parseNumeric = function(value) {
      var sign2 = parseBits(value, 16, 32);
      if (sign2 == 49152) {
        return NaN;
      }
      var weight = Math.pow(1e4, parseBits(value, 16, 16));
      var result = 0;
      var digits = [];
      var ndigits = parseBits(value, 16);
      for (var i = 0; i < ndigits; i++) {
        result += parseBits(value, 16, 64 + 16 * i) * weight;
        weight /= 1e4;
      }
      var scale = Math.pow(10, parseBits(value, 16, 48));
      return (sign2 === 0 ? 1 : -1) * Math.round(result * scale) / scale;
    };
    var parseDate = function(isUTC, value) {
      var sign2 = parseBits(value, 1);
      var rawValue = parseBits(value, 63, 1);
      var result = new Date((sign2 === 0 ? 1 : -1) * rawValue / 1e3 + 9466848e5);
      if (!isUTC) {
        result.setTime(result.getTime() + result.getTimezoneOffset() * 6e4);
      }
      result.usec = rawValue % 1e3;
      result.getMicroSeconds = function() {
        return this.usec;
      };
      result.setMicroSeconds = function(value2) {
        this.usec = value2;
      };
      result.getUTCMicroSeconds = function() {
        return this.usec;
      };
      return result;
    };
    var parseArray = function(value) {
      var dim = parseBits(value, 32);
      var flags = parseBits(value, 32, 32);
      var elementType = parseBits(value, 32, 64);
      var offset = 96;
      var dims = [];
      for (var i = 0; i < dim; i++) {
        dims[i] = parseBits(value, 32, offset);
        offset += 32;
        offset += 32;
      }
      var parseElement = function(elementType2) {
        var length = parseBits(value, 32, offset);
        offset += 32;
        if (length == 4294967295) {
          return null;
        }
        var result;
        if (elementType2 == 23 || elementType2 == 20) {
          result = parseBits(value, length * 8, offset);
          offset += length * 8;
          return result;
        } else if (elementType2 == 25) {
          result = value.toString(this.encoding, offset >> 3, (offset += length << 3) >> 3);
          return result;
        } else {
          console.log("ERROR: ElementType not implemented: " + elementType2);
        }
      };
      var parse = function(dimension, elementType2) {
        var array = [];
        var i2;
        if (dimension.length > 1) {
          var count = dimension.shift();
          for (i2 = 0; i2 < count; i2++) {
            array[i2] = parse(dimension, elementType2);
          }
          dimension.unshift(count);
        } else {
          for (i2 = 0; i2 < dimension[0]; i2++) {
            array[i2] = parseElement(elementType2);
          }
        }
        return array;
      };
      return parse(dims, elementType);
    };
    var parseText = function(value) {
      return value.toString("utf8");
    };
    var parseBool = function(value) {
      if (value === null) return null;
      return parseBits(value, 8) > 0;
    };
    var init = function(register) {
      register(20, parseInt64);
      register(21, parseInt16);
      register(23, parseInt32);
      register(26, parseInt32);
      register(1700, parseNumeric);
      register(700, parseFloat32);
      register(701, parseFloat64);
      register(16, parseBool);
      register(1114, parseDate.bind(null, false));
      register(1184, parseDate.bind(null, true));
      register(1e3, parseArray);
      register(1007, parseArray);
      register(1016, parseArray);
      register(1008, parseArray);
      register(1009, parseArray);
      register(25, parseText);
    };
    module.exports = {
      init
    };
  }
});

// ../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/builtins.js
var require_builtins = __commonJS({
  "../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/builtins.js"(exports, module) {
    module.exports = {
      BOOL: 16,
      BYTEA: 17,
      CHAR: 18,
      INT8: 20,
      INT2: 21,
      INT4: 23,
      REGPROC: 24,
      TEXT: 25,
      OID: 26,
      TID: 27,
      XID: 28,
      CID: 29,
      JSON: 114,
      XML: 142,
      PG_NODE_TREE: 194,
      SMGR: 210,
      PATH: 602,
      POLYGON: 604,
      CIDR: 650,
      FLOAT4: 700,
      FLOAT8: 701,
      ABSTIME: 702,
      RELTIME: 703,
      TINTERVAL: 704,
      CIRCLE: 718,
      MACADDR8: 774,
      MONEY: 790,
      MACADDR: 829,
      INET: 869,
      ACLITEM: 1033,
      BPCHAR: 1042,
      VARCHAR: 1043,
      DATE: 1082,
      TIME: 1083,
      TIMESTAMP: 1114,
      TIMESTAMPTZ: 1184,
      INTERVAL: 1186,
      TIMETZ: 1266,
      BIT: 1560,
      VARBIT: 1562,
      NUMERIC: 1700,
      REFCURSOR: 1790,
      REGPROCEDURE: 2202,
      REGOPER: 2203,
      REGOPERATOR: 2204,
      REGCLASS: 2205,
      REGTYPE: 2206,
      UUID: 2950,
      TXID_SNAPSHOT: 2970,
      PG_LSN: 3220,
      PG_NDISTINCT: 3361,
      PG_DEPENDENCIES: 3402,
      TSVECTOR: 3614,
      TSQUERY: 3615,
      GTSVECTOR: 3642,
      REGCONFIG: 3734,
      REGDICTIONARY: 3769,
      JSONB: 3802,
      REGNAMESPACE: 4089,
      REGROLE: 4096
    };
  }
});

// ../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/index.js
var require_pg_types = __commonJS({
  "../../node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/index.js"(exports) {
    var textParsers = require_textParsers();
    var binaryParsers = require_binaryParsers();
    var arrayParser = require_arrayParser();
    var builtinTypes = require_builtins();
    exports.getTypeParser = getTypeParser;
    exports.setTypeParser = setTypeParser;
    exports.arrayParser = arrayParser;
    exports.builtins = builtinTypes;
    var typeParsers = {
      text: {},
      binary: {}
    };
    function noParse(val) {
      return String(val);
    }
    function getTypeParser(oid, format) {
      format = format || "text";
      if (!typeParsers[format]) {
        return noParse;
      }
      return typeParsers[format][oid] || noParse;
    }
    function setTypeParser(oid, format, parseFn) {
      if (typeof format == "function") {
        parseFn = format;
        format = "text";
      }
      typeParsers[format][oid] = parseFn;
    }
    textParsers.init(function(oid, converter) {
      typeParsers.text[oid] = converter;
    });
    binaryParsers.init(function(oid, converter) {
      typeParsers.binary[oid] = converter;
    });
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/defaults.js
var require_defaults = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/defaults.js"(exports, module) {
    "use strict";
    var user;
    try {
      user = process.platform === "win32" ? process.env.USERNAME : process.env.USER;
    } catch {
    }
    module.exports = {
      // database host. defaults to localhost
      host: "localhost",
      // database user's name
      user,
      // name of database to connect
      database: void 0,
      // database user's password
      password: null,
      // a Postgres connection string to be used instead of setting individual connection items
      // NOTE:  Setting this value will cause it to override any other value (such as database or user) defined
      // in the defaults object.
      connectionString: void 0,
      // database port
      port: 5432,
      // number of rows to return at a time from a prepared statement's
      // portal. 0 will return all rows at once
      rows: 0,
      // binary result mode
      binary: false,
      // Connection pool options - see https://github.com/brianc/node-pg-pool
      // number of connections to use in connection pool
      // 0 will disable connection pooling
      max: 10,
      // max milliseconds a client can go unused before it is removed
      // from the pool and destroyed
      idleTimeoutMillis: 3e4,
      client_encoding: "",
      ssl: false,
      // SSL negotiation style: 'postgres' (traditional SSLRequest) or 'direct'
      sslnegotiation: void 0,
      application_name: void 0,
      fallback_application_name: void 0,
      options: void 0,
      parseInputDatesAsUTC: false,
      // max milliseconds any query using this connection will execute for before timing out in error.
      // false=unlimited
      statement_timeout: false,
      // Abort any statement that waits longer than the specified duration in milliseconds while attempting to acquire a lock.
      // false=unlimited
      lock_timeout: false,
      // Terminate any session with an open transaction that has been idle for longer than the specified duration in milliseconds
      // false=unlimited
      idle_in_transaction_session_timeout: false,
      // max milliseconds to wait for query to complete (client side)
      query_timeout: false,
      connect_timeout: 0,
      keepalives: 1,
      keepalives_idle: 0
    };
    var pgTypes = require_pg_types();
    var parseBigInteger = pgTypes.getTypeParser(20, "text");
    var parseBigIntegerArray = pgTypes.getTypeParser(1016, "text");
    module.exports.__defineSetter__("parseInt8", function(val) {
      pgTypes.setTypeParser(20, "text", val ? pgTypes.getTypeParser(23, "text") : parseBigInteger);
      pgTypes.setTypeParser(1016, "text", val ? pgTypes.getTypeParser(1007, "text") : parseBigIntegerArray);
    });
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/utils.js
var require_utils = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/utils.js"(exports, module) {
    "use strict";
    var defaults2 = require_defaults();
    var { isDate } = __require("util/types");
    function escapeElement(elementRepresentation) {
      const escaped = elementRepresentation.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return '"' + escaped + '"';
    }
    function arrayString(val) {
      let result = "{";
      for (let i = 0; i < val.length; i++) {
        if (i > 0) {
          result += ",";
        }
        let item = val[i];
        if (item == null) {
          result += "NULL";
        } else if (Array.isArray(item)) {
          result += arrayString(item);
        } else if (ArrayBuffer.isView(item)) {
          if (!(item instanceof Buffer)) {
            item = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
          }
          result += "\\\\x" + item.toString("hex");
        } else {
          result += escapeElement(prepareValue(item));
        }
      }
      result += "}";
      return result;
    }
    var prepareValue = function(val, seen) {
      if (val == null) {
        return null;
      }
      if (typeof val === "object") {
        if (val instanceof Buffer) {
          return val;
        }
        if (ArrayBuffer.isView(val)) {
          return Buffer.from(val.buffer, val.byteOffset, val.byteLength);
        }
        if (isDate(val)) {
          if (defaults2.parseInputDatesAsUTC) {
            return dateToStringUTC(val);
          } else {
            return dateToString(val);
          }
        }
        if (Array.isArray(val)) {
          return arrayString(val);
        }
        return prepareObject(val, seen);
      }
      return val.toString();
    };
    function prepareObject(val, seen) {
      if (val && typeof val.toPostgres === "function") {
        seen = seen || [];
        if (seen.indexOf(val) !== -1) {
          throw new Error('circular reference detected while preparing "' + val + '" for query');
        }
        seen.push(val);
        return prepareValue(val.toPostgres(prepareValue), seen);
      }
      return JSON.stringify(val);
    }
    function dateToString(date) {
      let offset = -date.getTimezoneOffset();
      let year = date.getFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + "T" + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0") + "." + String(date.getMilliseconds()).padStart(3, "0");
      if (offset < 0) {
        ret += "-";
        offset *= -1;
      } else {
        ret += "+";
      }
      ret += String(Math.floor(offset / 60)).padStart(2, "0") + ":" + String(offset % 60).padStart(2, "0");
      if (isBCYear) ret += " BC";
      return ret;
    }
    function dateToStringUTC(date) {
      let year = date.getUTCFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0") + "T" + String(date.getUTCHours()).padStart(2, "0") + ":" + String(date.getUTCMinutes()).padStart(2, "0") + ":" + String(date.getUTCSeconds()).padStart(2, "0") + "." + String(date.getUTCMilliseconds()).padStart(3, "0");
      ret += "+00:00";
      if (isBCYear) ret += " BC";
      return ret;
    }
    function normalizeQueryConfig(config, values, callback) {
      config = typeof config === "string" ? { text: config } : config;
      if (values) {
        if (typeof values === "function") {
          config.callback = values;
        } else {
          config.values = values;
        }
      }
      if (callback) {
        config.callback = callback;
      }
      return config;
    }
    var escapeIdentifier2 = function(str3) {
      return '"' + str3.replace(/"/g, '""') + '"';
    };
    var escapeLiteral2 = function(str3) {
      let hasBackslash = false;
      let escaped = "'";
      if (str3 == null) {
        return "''";
      }
      if (typeof str3 !== "string") {
        return "''";
      }
      for (let i = 0; i < str3.length; i++) {
        const c = str3[i];
        if (c === "'") {
          escaped += c + c;
        } else if (c === "\\") {
          escaped += c + c;
          hasBackslash = true;
        } else {
          escaped += c;
        }
      }
      escaped += "'";
      if (hasBackslash === true) {
        escaped = " E" + escaped;
      }
      return escaped;
    };
    module.exports = {
      prepareValue: function prepareValueWrapper(value) {
        return prepareValue(value);
      },
      normalizeQueryConfig,
      escapeIdentifier: escapeIdentifier2,
      escapeLiteral: escapeLiteral2
    };
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/utils.js
var require_utils2 = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/utils.js"(exports, module) {
    var nodeCrypto = __require("crypto");
    module.exports = {
      postgresMd5PasswordHash,
      randomBytes: randomBytes6,
      deriveKey,
      sha256,
      hashByName,
      hmacSha256,
      md5
    };
    var webCrypto = nodeCrypto.webcrypto || globalThis.crypto;
    var subtleCrypto = webCrypto.subtle;
    var textEncoder = new TextEncoder();
    function randomBytes6(length) {
      return webCrypto.getRandomValues(Buffer.alloc(length));
    }
    async function md5(string) {
      try {
        return nodeCrypto.createHash("md5").update(string, "utf-8").digest("hex");
      } catch (e) {
        const data = typeof string === "string" ? textEncoder.encode(string) : string;
        const hash = await subtleCrypto.digest("MD5", data);
        return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    }
    async function postgresMd5PasswordHash(user, password, salt) {
      const inner = await md5(password + user);
      const outer = await md5(Buffer.concat([Buffer.from(inner), salt]));
      return "md5" + outer;
    }
    async function sha256(text) {
      return await subtleCrypto.digest("SHA-256", text);
    }
    async function hashByName(hashName, text) {
      return await subtleCrypto.digest(hashName, text);
    }
    async function hmacSha256(keyBuffer, msg) {
      const key = await subtleCrypto.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return await subtleCrypto.sign("HMAC", key, textEncoder.encode(msg));
    }
    async function deriveKey(password, salt, iterations) {
      const key = await subtleCrypto.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
      const params = { name: "PBKDF2", hash: "SHA-256", salt, iterations };
      return await subtleCrypto.deriveBits(params, key, 32 * 8, ["deriveBits"]);
    }
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/cert-signatures.js
var require_cert_signatures = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/cert-signatures.js"(exports, module) {
    function x509Error(msg, cert) {
      return new Error("SASL channel binding: " + msg + " when parsing public certificate " + cert.toString("base64"));
    }
    function readASN1Length(data, index) {
      let length = data[index++];
      if (length < 128) return { length, index };
      const lengthBytes = length & 127;
      if (lengthBytes > 4) throw x509Error("bad length", data);
      length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = length << 8 | data[index++];
      }
      return { length, index };
    }
    function readASN1OID(data, index) {
      if (data[index++] !== 6) throw x509Error("non-OID data", data);
      const { length: OIDLength, index: indexAfterOIDLength } = readASN1Length(data, index);
      index = indexAfterOIDLength;
      const lastIndex = index + OIDLength;
      const byte1 = data[index++];
      let oid = (byte1 / 40 >> 0) + "." + byte1 % 40;
      while (index < lastIndex) {
        let value = 0;
        while (index < lastIndex) {
          const nextByte = data[index++];
          value = value << 7 | nextByte & 127;
          if (nextByte < 128) break;
        }
        oid += "." + value;
      }
      return { oid, index };
    }
    function expectASN1Seq(data, index) {
      if (data[index++] !== 48) throw x509Error("non-sequence data", data);
      return readASN1Length(data, index);
    }
    function signatureAlgorithmHashFromCertificate(data, index) {
      if (index === void 0) index = 0;
      index = expectASN1Seq(data, index).index;
      const { length: certInfoLength, index: indexAfterCertInfoLength } = expectASN1Seq(data, index);
      index = indexAfterCertInfoLength + certInfoLength;
      index = expectASN1Seq(data, index).index;
      const { oid, index: indexAfterOID } = readASN1OID(data, index);
      switch (oid) {
        // RSA
        case "1.2.840.113549.1.1.4":
          return "MD5";
        case "1.2.840.113549.1.1.5":
          return "SHA-1";
        case "1.2.840.113549.1.1.11":
          return "SHA-256";
        case "1.2.840.113549.1.1.12":
          return "SHA-384";
        case "1.2.840.113549.1.1.13":
          return "SHA-512";
        case "1.2.840.113549.1.1.14":
          return "SHA-224";
        case "1.2.840.113549.1.1.15":
          return "SHA512-224";
        case "1.2.840.113549.1.1.16":
          return "SHA512-256";
        // ECDSA
        case "1.2.840.10045.4.1":
          return "SHA-1";
        case "1.2.840.10045.4.3.1":
          return "SHA-224";
        case "1.2.840.10045.4.3.2":
          return "SHA-256";
        case "1.2.840.10045.4.3.3":
          return "SHA-384";
        case "1.2.840.10045.4.3.4":
          return "SHA-512";
        // RSASSA-PSS: hash is indicated separately
        case "1.2.840.113549.1.1.10": {
          index = indexAfterOID;
          index = expectASN1Seq(data, index).index;
          if (data[index++] !== 160) throw x509Error("non-tag data", data);
          index = readASN1Length(data, index).index;
          index = expectASN1Seq(data, index).index;
          const { oid: hashOID } = readASN1OID(data, index);
          switch (hashOID) {
            // standalone hash OIDs
            case "1.2.840.113549.2.5":
              return "MD5";
            case "1.3.14.3.2.26":
              return "SHA-1";
            case "2.16.840.1.101.3.4.2.1":
              return "SHA-256";
            case "2.16.840.1.101.3.4.2.2":
              return "SHA-384";
            case "2.16.840.1.101.3.4.2.3":
              return "SHA-512";
          }
          throw x509Error("unknown hash OID " + hashOID, data);
        }
        // Ed25519 -- see https: return//github.com/openssl/openssl/issues/15477
        case "1.3.101.110":
        case "1.3.101.112":
          return "SHA-512";
        // Ed448 -- still not in pg 17.2 (if supported, digest would be SHAKE256 x 64 bytes)
        case "1.3.101.111":
        case "1.3.101.113":
          throw x509Error("Ed448 certificate channel binding is not currently supported by Postgres");
      }
      throw x509Error("unknown OID " + oid, data);
    }
    module.exports = { signatureAlgorithmHashFromCertificate };
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/sasl.js
var require_sasl = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/sasl.js"(exports, module) {
    "use strict";
    var crypto = require_utils2();
    var { signatureAlgorithmHashFromCertificate } = require_cert_signatures();
    function saslprep(password) {
      const nonAsciiSpace = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g;
      const mappedToNothing = /[\u00AD\u034F\u1806\u180B\u180C\u180D\u200C\u200D\u2060\uFE00-\uFE0F\uFEFF]/g;
      return password.replace(nonAsciiSpace, " ").replace(mappedToNothing, "").normalize("NFKC");
    }
    var DEFAULT_MAX_SCRAM_ITERATIONS = 1e5;
    function startSession(mechanisms, stream, scramMaxIterations = DEFAULT_MAX_SCRAM_ITERATIONS) {
      const candidates = ["SCRAM-SHA-256"];
      if (stream) candidates.unshift("SCRAM-SHA-256-PLUS");
      const mechanism = candidates.find((candidate) => mechanisms.includes(candidate));
      if (!mechanism) {
        throw new Error("SASL: Only mechanism(s) " + candidates.join(" and ") + " are supported");
      }
      if (mechanism === "SCRAM-SHA-256-PLUS" && typeof stream.getPeerCertificate !== "function") {
        throw new Error("SASL: Mechanism SCRAM-SHA-256-PLUS requires a certificate");
      }
      const clientNonce = crypto.randomBytes(18).toString("base64");
      const gs2Header = mechanism === "SCRAM-SHA-256-PLUS" ? "p=tls-server-end-point" : stream ? "y" : "n";
      return {
        mechanism,
        clientNonce,
        response: gs2Header + ",,n=*,r=" + clientNonce,
        message: "SASLInitialResponse",
        scramMaxIterations
      };
    }
    async function continueSession(session, password, serverData, stream) {
      if (session.message !== "SASLInitialResponse") {
        throw new Error("SASL: Last message was not SASLInitialResponse");
      }
      if (typeof password !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string");
      }
      if (password === "") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string");
      }
      if (typeof serverData !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: serverData must be a string");
      }
      const sv = parseServerFirstMessage(serverData);
      if (!sv.nonce.startsWith(session.clientNonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
      } else if (sv.nonce.length === session.clientNonce.length) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short");
      }
      const scramMaxIterations = typeof session.scramMaxIterations === "number" ? session.scramMaxIterations : DEFAULT_MAX_SCRAM_ITERATIONS;
      if (scramMaxIterations !== 0 && sv.iteration > scramMaxIterations) {
        throw new Error(
          "SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration count " + sv.iteration + " exceeds scramMaxIterations of " + scramMaxIterations
        );
      }
      const clientFirstMessageBare = "n=*,r=" + session.clientNonce;
      const serverFirstMessage = "r=" + sv.nonce + ",s=" + sv.salt + ",i=" + sv.iteration;
      let channelBinding = stream ? "eSws" : "biws";
      if (session.mechanism === "SCRAM-SHA-256-PLUS") {
        const peerCert = stream.getPeerCertificate().raw;
        let hashName = signatureAlgorithmHashFromCertificate(peerCert);
        if (hashName === "MD5" || hashName === "SHA-1") hashName = "SHA-256";
        const certHash = await crypto.hashByName(hashName, peerCert);
        const bindingData = Buffer.concat([Buffer.from("p=tls-server-end-point,,"), Buffer.from(certHash)]);
        channelBinding = bindingData.toString("base64");
      }
      const clientFinalMessageWithoutProof = "c=" + channelBinding + ",r=" + sv.nonce;
      const authMessage = clientFirstMessageBare + "," + serverFirstMessage + "," + clientFinalMessageWithoutProof;
      const saltBytes = Buffer.from(sv.salt, "base64");
      const saltedPassword = await crypto.deriveKey(saslprep(password), saltBytes, sv.iteration);
      const clientKey = await crypto.hmacSha256(saltedPassword, "Client Key");
      const storedKey = await crypto.sha256(clientKey);
      const clientSignature = await crypto.hmacSha256(storedKey, authMessage);
      const clientProof = xorBuffers(Buffer.from(clientKey), Buffer.from(clientSignature)).toString("base64");
      const serverKey = await crypto.hmacSha256(saltedPassword, "Server Key");
      const serverSignatureBytes = await crypto.hmacSha256(serverKey, authMessage);
      session.message = "SASLResponse";
      session.serverSignature = Buffer.from(serverSignatureBytes).toString("base64");
      session.response = clientFinalMessageWithoutProof + ",p=" + clientProof;
    }
    function finalizeSession(session, serverData) {
      if (session.message !== "SASLResponse") {
        throw new Error("SASL: Last message was not SASLResponse");
      }
      if (typeof serverData !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: serverData must be a string");
      }
      const { serverSignature } = parseServerFinalMessage(serverData);
      if (serverSignature !== session.serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature does not match");
      }
    }
    function isPrintableChars(text) {
      if (typeof text !== "string") {
        throw new TypeError("SASL: text must be a string");
      }
      return text.split("").map((_, i) => text.charCodeAt(i)).every((c) => c >= 33 && c <= 43 || c >= 45 && c <= 126);
    }
    function isBase64(text) {
      return /^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(text);
    }
    function parseAttributePairs(text) {
      if (typeof text !== "string") {
        throw new TypeError("SASL: attribute pairs text must be a string");
      }
      return new Map(
        text.split(",").map((attrValue) => {
          if (!/^.=/.test(attrValue)) {
            throw new Error("SASL: Invalid attribute pair entry");
          }
          const name = attrValue[0];
          const value = attrValue.substring(2);
          return [name, value];
        })
      );
    }
    function parseServerFirstMessage(data) {
      const attrPairs = parseAttributePairs(data);
      const nonce = attrPairs.get("r");
      if (!nonce) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing");
      } else if (!isPrintableChars(nonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce must only contain printable characters");
      }
      const salt = attrPairs.get("s");
      if (!salt) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing");
      } else if (!isBase64(salt)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt must be base64");
      }
      const iterationText = attrPairs.get("i");
      if (!iterationText) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration missing");
      } else if (!/^[1-9][0-9]*$/.test(iterationText)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: invalid iteration count");
      }
      const iteration = parseInt(iterationText, 10);
      return {
        nonce,
        salt,
        iteration
      };
    }
    function parseServerFinalMessage(serverData) {
      const attrPairs = parseAttributePairs(serverData);
      const error = attrPairs.get("e");
      const serverSignature = attrPairs.get("v");
      if (error) {
        throw new Error(`SASL: SCRAM-SERVER-FINAL-MESSAGE: server returned error: "${error}"`);
      }
      if (!serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing");
      } else if (!isBase64(serverSignature)) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature must be base64");
      }
      return {
        serverSignature
      };
    }
    function xorBuffers(a, b) {
      if (!Buffer.isBuffer(a)) {
        throw new TypeError("first argument must be a Buffer");
      }
      if (!Buffer.isBuffer(b)) {
        throw new TypeError("second argument must be a Buffer");
      }
      if (a.length !== b.length) {
        throw new Error("Buffer lengths must match");
      }
      if (a.length === 0) {
        throw new Error("Buffers cannot be empty");
      }
      return Buffer.from(a.map((_, i) => a[i] ^ b[i]));
    }
    module.exports = {
      startSession,
      continueSession,
      finalizeSession,
      DEFAULT_MAX_SCRAM_ITERATIONS
    };
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/type-overrides.js
var require_type_overrides = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/type-overrides.js"(exports, module) {
    "use strict";
    var types2 = require_pg_types();
    function TypeOverrides2(userTypes) {
      this._types = userTypes || types2;
      this.text = {};
      this.binary = {};
    }
    TypeOverrides2.prototype.getOverrides = function(format) {
      switch (format) {
        case "text":
          return this.text;
        case "binary":
          return this.binary;
        default:
          return {};
      }
    };
    TypeOverrides2.prototype.setTypeParser = function(oid, format, parseFn) {
      if (typeof format === "function") {
        parseFn = format;
        format = "text";
      }
      this.getOverrides(format)[oid] = parseFn;
    };
    TypeOverrides2.prototype.getTypeParser = function(oid, format) {
      format = format || "text";
      return this.getOverrides(format)[oid] || this._types.getTypeParser(oid, format);
    };
    module.exports = TypeOverrides2;
  }
});

// ../../node_modules/.pnpm/pg-connection-string@2.14.0/node_modules/pg-connection-string/index.js
var require_pg_connection_string = __commonJS({
  "../../node_modules/.pnpm/pg-connection-string@2.14.0/node_modules/pg-connection-string/index.js"(exports, module) {
    "use strict";
    function parse(str3, options = {}) {
      if (str3.charAt(0) === "/") {
        const config2 = str3.split(" ");
        return { host: config2[0], database: config2[1] };
      }
      const config = /* @__PURE__ */ Object.create(null);
      let result;
      let dummyHost = false;
      if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str3)) {
        str3 = encodeURI(str3).replace(/%25(\d\d)/g, "%$1");
      }
      try {
        try {
          result = new URL(str3, "postgres://base");
        } catch (e) {
          result = new URL(str3.replace("@/", "@___DUMMY___/"), "postgres://base");
          dummyHost = true;
        }
      } catch (err) {
        err.input && (err.input = "*****REDACTED*****");
        throw err;
      }
      for (const entry of result.searchParams.entries()) {
        config[entry[0]] = entry[1];
      }
      config.user = config.user || decodeURIComponent(result.username);
      config.password = config.password || decodeURIComponent(result.password);
      if (result.protocol == "socket:") {
        config.host = decodeURI(result.pathname);
        config.database = result.searchParams.get("db");
        config.client_encoding = result.searchParams.get("encoding");
        return config;
      }
      const hostname = dummyHost ? "" : result.hostname;
      if (!config.host) {
        config.host = decodeURIComponent(hostname);
      } else if (hostname && /^%2f/i.test(hostname)) {
        result.pathname = hostname + result.pathname;
      }
      if (!config.port) {
        config.port = result.port;
      }
      const pathname = result.pathname.slice(1) || null;
      config.database = pathname ? decodeURI(pathname) : null;
      if (config.ssl === "true" || config.ssl === "1") {
        config.ssl = true;
      }
      if (config.ssl === "0") {
        config.ssl = false;
      }
      if (config.sslcert || config.sslkey || config.sslrootcert || config.sslmode) {
        config.ssl = {};
      }
      if (config.sslnegotiation === "direct" && config.ssl === void 0) {
        config.ssl = true;
      }
      const fs = config.sslcert || config.sslkey || config.sslrootcert ? __require("fs") : null;
      if (config.sslcert) {
        config.ssl.cert = fs.readFileSync(config.sslcert).toString();
      }
      if (config.sslkey) {
        config.ssl.key = fs.readFileSync(config.sslkey).toString();
      }
      if (config.sslrootcert) {
        config.ssl.ca = fs.readFileSync(config.sslrootcert).toString();
      }
      if (options.useLibpqCompat && config.uselibpqcompat) {
        throw new Error("Both useLibpqCompat and uselibpqcompat are set. Please use only one of them.");
      }
      if (config.uselibpqcompat === "true" || options.useLibpqCompat) {
        switch (config.sslmode) {
          case "disable": {
            config.ssl = false;
            break;
          }
          case "prefer": {
            config.ssl.rejectUnauthorized = false;
            break;
          }
          case "require": {
            if (config.sslrootcert) {
              config.ssl.checkServerIdentity = function() {
              };
            } else {
              config.ssl.rejectUnauthorized = false;
            }
            break;
          }
          case "verify-ca": {
            if (!config.ssl.ca) {
              throw new Error(
                "SECURITY WARNING: Using sslmode=verify-ca requires specifying a CA with sslrootcert. If a public CA is used, verify-ca allows connections to a server that somebody else may have registered with the CA, making you vulnerable to Man-in-the-Middle attacks. Either specify a custom CA certificate with sslrootcert parameter or use sslmode=verify-full for proper security."
              );
            }
            config.ssl.checkServerIdentity = function() {
            };
            break;
          }
          case "verify-full": {
            break;
          }
        }
      } else {
        switch (config.sslmode) {
          case "disable": {
            config.ssl = false;
            break;
          }
          case "prefer":
          case "require":
          case "verify-ca":
          case "verify-full": {
            if (config.sslmode !== "verify-full") {
              deprecatedSslModeWarning(config.sslmode);
            }
            break;
          }
          case "no-verify": {
            config.ssl.rejectUnauthorized = false;
            break;
          }
        }
      }
      return config;
    }
    function toConnectionOptions(sslConfig) {
      const connectionOptions = Object.entries(sslConfig).reduce((c, [key, value]) => {
        if (value !== void 0 && value !== null) {
          c[key] = value;
        }
        return c;
      }, /* @__PURE__ */ Object.create(null));
      return connectionOptions;
    }
    function toClientConfig(config) {
      const poolConfig = Object.entries(config).reduce((c, [key, value]) => {
        if (key === "ssl") {
          const sslConfig = value;
          if (typeof sslConfig === "boolean") {
            c[key] = sslConfig;
          }
          if (typeof sslConfig === "object") {
            c[key] = toConnectionOptions(sslConfig);
          }
        } else if (value !== void 0 && value !== null) {
          if (key === "port") {
            if (value !== "") {
              const v = parseInt(value, 10);
              if (isNaN(v)) {
                throw new Error(`Invalid ${key}: ${value}`);
              }
              c[key] = v;
            }
          } else {
            c[key] = value;
          }
        }
        return c;
      }, /* @__PURE__ */ Object.create(null));
      return poolConfig;
    }
    function parseIntoClientConfig(str3) {
      return toClientConfig(parse(str3));
    }
    function deprecatedSslModeWarning(sslmode) {
      if (!deprecatedSslModeWarning.warned && typeof process !== "undefined" && process.emitWarning) {
        deprecatedSslModeWarning.warned = true;
        process.emitWarning(`SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.

To prepare for this change:
- If you want the current behavior, explicitly use 'sslmode=verify-full'
- If you want libpq compatibility now, use 'uselibpqcompat=true&sslmode=${sslmode}'

See https://www.postgresql.org/docs/current/libpq-ssl.html for libpq SSL mode definitions.`);
      }
    }
    module.exports = parse;
    parse.parse = parse;
    parse.toClientConfig = toClientConfig;
    parse.parseIntoClientConfig = parseIntoClientConfig;
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection-parameters.js
var require_connection_parameters = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection-parameters.js"(exports, module) {
    "use strict";
    var dns = __require("dns");
    var defaults2 = require_defaults();
    var parse = require_pg_connection_string().parse;
    var val = function(key, config, envVar) {
      if (config[key]) {
        return config[key];
      }
      if (envVar === void 0) {
        envVar = process.env["PG" + key.toUpperCase()];
      } else if (envVar === false) {
      } else {
        envVar = process.env[envVar];
      }
      return envVar || defaults2[key];
    };
    var readSSLConfigFromEnvironment = function() {
      switch (process.env.PGSSLMODE) {
        case "disable":
          return false;
        case "prefer":
        case "require":
        case "verify-ca":
        case "verify-full":
          return true;
        case "no-verify":
          return { rejectUnauthorized: false };
      }
      return defaults2.ssl;
    };
    var quoteParamValue = function(value) {
      return "'" + ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    };
    var add2 = function(params, config, paramName) {
      const value = config[paramName];
      if (value !== void 0 && value !== null) {
        params.push(paramName + "=" + quoteParamValue(value));
      }
    };
    var ConnectionParameters = class {
      constructor(config) {
        config = typeof config === "string" ? parse(config) : config || {};
        if (config.connectionString) {
          config = Object.assign({}, config, parse(config.connectionString));
        }
        this.user = val("user", config);
        this.database = val("database", config);
        if (this.database === void 0) {
          this.database = this.user;
        }
        this.port = parseInt(val("port", config), 10);
        this.host = val("host", config);
        Object.defineProperty(this, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: val("password", config)
        });
        this.binary = val("binary", config);
        this.options = val("options", config);
        this.ssl = typeof config.ssl === "undefined" ? readSSLConfigFromEnvironment() : config.ssl;
        if (typeof this.ssl === "string") {
          if (this.ssl === "true") {
            this.ssl = true;
          }
        }
        if (this.ssl === "no-verify") {
          this.ssl = { rejectUnauthorized: false };
        }
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this.sslnegotiation = val("sslnegotiation", config, "PGSSLNEGOTIATION");
        if (this.sslnegotiation !== void 0 && this.sslnegotiation !== "postgres" && this.sslnegotiation !== "direct") {
          throw new Error(
            `Invalid sslnegotiation value: "${this.sslnegotiation}". Valid values are "postgres" and "direct".`
          );
        }
        if (this.sslnegotiation === "direct" && !this.ssl) {
          throw new Error("sslnegotiation=direct requires SSL to be enabled");
        }
        this.client_encoding = val("client_encoding", config);
        this.replication = val("replication", config);
        this.isDomainSocket = !(this.host || "").indexOf("/");
        this.application_name = val("application_name", config, "PGAPPNAME");
        this.fallback_application_name = val("fallback_application_name", config, false);
        this.statement_timeout = val("statement_timeout", config, false);
        this.lock_timeout = val("lock_timeout", config, false);
        this.idle_in_transaction_session_timeout = val("idle_in_transaction_session_timeout", config, false);
        this.query_timeout = val("query_timeout", config, false);
        if (config.connectionTimeoutMillis === void 0) {
          this.connect_timeout = process.env.PGCONNECT_TIMEOUT || 0;
        } else {
          this.connect_timeout = Math.floor(config.connectionTimeoutMillis / 1e3);
        }
        if (config.keepAlive === false) {
          this.keepalives = 0;
        } else if (config.keepAlive === true) {
          this.keepalives = 1;
        }
        if (typeof config.keepAliveInitialDelayMillis === "number") {
          this.keepalives_idle = Math.floor(config.keepAliveInitialDelayMillis / 1e3);
        }
      }
      getLibpqConnectionString(cb) {
        const params = [];
        add2(params, this, "user");
        add2(params, this, "password");
        add2(params, this, "port");
        add2(params, this, "application_name");
        add2(params, this, "fallback_application_name");
        add2(params, this, "connect_timeout");
        add2(params, this, "options");
        const ssl = typeof this.ssl === "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
        add2(params, ssl, "sslmode");
        add2(params, ssl, "sslca");
        add2(params, ssl, "sslkey");
        add2(params, ssl, "sslcert");
        add2(params, ssl, "sslrootcert");
        add2(params, this, "sslnegotiation");
        if (this.database) {
          params.push("dbname=" + quoteParamValue(this.database));
        }
        if (this.replication) {
          params.push("replication=" + quoteParamValue(this.replication));
        }
        if (this.host) {
          params.push("host=" + quoteParamValue(this.host));
        }
        if (this.isDomainSocket) {
          return cb(null, params.join(" "));
        }
        if (this.client_encoding) {
          params.push("client_encoding=" + quoteParamValue(this.client_encoding));
        }
        dns.lookup(this.host, function(err, address) {
          if (err) return cb(err, null);
          params.push("hostaddr=" + quoteParamValue(address));
          return cb(null, params.join(" "));
        });
      }
    };
    module.exports = ConnectionParameters;
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/result.js
var require_result = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/result.js"(exports, module) {
    "use strict";
    var types2 = require_pg_types();
    var matchRegexp = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;
    var Result2 = class {
      constructor(rowMode, types3) {
        this.command = null;
        this.rowCount = null;
        this.oid = null;
        this.rows = [];
        this.fields = [];
        this._parsers = void 0;
        this._types = types3;
        this.RowCtor = null;
        this.rowAsArray = rowMode === "array";
        if (this.rowAsArray) {
          this.parseRow = this._parseRowAsArray;
        }
        this._prebuiltEmptyResultObject = null;
      }
      // adds a command complete message
      addCommandComplete(msg) {
        let match;
        if (msg.text) {
          match = matchRegexp.exec(msg.text);
        } else {
          match = matchRegexp.exec(msg.command);
        }
        if (match) {
          this.command = match[1];
          if (match[3]) {
            this.oid = parseInt(match[2], 10);
            this.rowCount = parseInt(match[3], 10);
          } else if (match[2]) {
            this.rowCount = parseInt(match[2], 10);
          }
        }
      }
      _parseRowAsArray(rowData) {
        const row = new Array(rowData.length);
        for (let i = 0, len = rowData.length; i < len; i++) {
          const rawValue = rowData[i];
          if (rawValue !== null) {
            row[i] = this._parsers[i](rawValue);
          } else {
            row[i] = null;
          }
        }
        return row;
      }
      parseRow(rowData) {
        const row = { ...this._prebuiltEmptyResultObject };
        for (let i = 0, len = rowData.length; i < len; i++) {
          const rawValue = rowData[i];
          const field = this.fields[i].name;
          if (rawValue !== null) {
            const v = this.fields[i].format === "binary" ? Buffer.from(rawValue) : rawValue;
            row[field] = this._parsers[i](v);
          } else {
            row[field] = null;
          }
        }
        return row;
      }
      addRow(row) {
        this.rows.push(row);
      }
      addFields(fieldDescriptions) {
        this.fields = fieldDescriptions;
        if (this.fields.length) {
          this._parsers = new Array(fieldDescriptions.length);
        }
        const row = /* @__PURE__ */ Object.create(null);
        for (let i = 0; i < fieldDescriptions.length; i++) {
          const desc = fieldDescriptions[i];
          row[desc.name] = null;
          if (this._types) {
            this._parsers[i] = this._types.getTypeParser(desc.dataTypeID, desc.format || "text");
          } else {
            this._parsers[i] = types2.getTypeParser(desc.dataTypeID, desc.format || "text");
          }
        }
        this._prebuiltEmptyResultObject = { ...row };
      }
    };
    module.exports = Result2;
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/query.js
var require_query = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/query.js"(exports, module) {
    "use strict";
    var { EventEmitter } = __require("events");
    var Result2 = require_result();
    var utils = require_utils();
    var Query2 = class extends EventEmitter {
      constructor(config, values, callback) {
        super();
        config = utils.normalizeQueryConfig(config, values, callback);
        this.text = config.text;
        this.values = config.values;
        this.rows = config.rows;
        this.types = config.types;
        this.name = config.name;
        this.queryMode = config.queryMode;
        this.binary = config.binary;
        this.portal = config.portal || "";
        this.callback = config.callback;
        this._rowMode = config.rowMode;
        if (process.domain && config.callback) {
          this.callback = process.domain.bind(config.callback);
        }
        this._result = new Result2(this._rowMode, this.types);
        this._results = this._result;
        this._canceledDueToError = false;
      }
      requiresPreparation() {
        if (this.queryMode === "extended") {
          return true;
        }
        if (this.name) {
          return true;
        }
        if (this.rows) {
          return true;
        }
        if (!this.text) {
          return false;
        }
        if (!this.values) {
          return false;
        }
        return this.values.length > 0;
      }
      _checkForMultirow() {
        if (this._result.command) {
          if (!Array.isArray(this._results)) {
            this._results = [this._result];
          }
          this._result = new Result2(this._rowMode, this._result._types);
          this._results.push(this._result);
        }
      }
      // associates row metadata from the supplied
      // message with this query object
      // metadata used when parsing row results
      handleRowDescription(msg) {
        this._checkForMultirow();
        this._result.addFields(msg.fields);
        this._accumulateRows = this.callback || !this.listeners("row").length;
      }
      handleDataRow(msg) {
        let row;
        if (this._canceledDueToError) {
          return;
        }
        try {
          row = this._result.parseRow(msg.fields);
        } catch (err) {
          this._canceledDueToError = err;
          return;
        }
        this.emit("row", row, this._result);
        if (this._accumulateRows) {
          this._result.addRow(row);
        }
      }
      handleCommandComplete(msg, connection) {
        this._checkForMultirow();
        this._result.addCommandComplete(msg);
        if (this.rows) {
          connection.sync();
        }
      }
      // if a named prepared statement is created with empty query text
      // the backend will send an emptyQuery message but *not* a command complete message
      // since we pipeline sync immediately after execute we don't need to do anything here
      // unless we have rows specified, in which case we did not pipeline the initial sync call
      handleEmptyQuery(connection) {
        if (this.rows) {
          connection.sync();
        }
      }
      handleError(err, connection) {
        if (this._canceledDueToError) {
          err = this._canceledDueToError;
          this._canceledDueToError = false;
        }
        if (this.callback) {
          return this.callback(err);
        }
        this.emit("error", err);
      }
      handleReadyForQuery(con) {
        if (this._canceledDueToError) {
          return this.handleError(this._canceledDueToError, con);
        }
        if (this.callback) {
          try {
            this.callback(null, this._results);
          } catch (err) {
            process.nextTick(() => {
              throw err;
            });
          }
        }
        this.emit("end", this._results);
      }
      submit(connection) {
        if (typeof this.text !== "string" && typeof this.name !== "string") {
          return new Error("A query must have either text or a name. Supplying neither is unsupported.");
        }
        const previous = connection.parsedStatements[this.name];
        if (this.text && previous && this.text !== previous) {
          return new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
        }
        if (this.values && !Array.isArray(this.values)) {
          return new Error("Query values must be an array");
        }
        if (this.requiresPreparation()) {
          connection.stream.cork && connection.stream.cork();
          try {
            this.prepare(connection);
          } finally {
            connection.stream.uncork && connection.stream.uncork();
          }
        } else {
          connection.query(this.text);
        }
        return null;
      }
      hasBeenParsed(connection) {
        return this.name && connection.parsedStatements[this.name];
      }
      handlePortalSuspended(connection) {
        this._getRows(connection, this.rows);
      }
      _getRows(connection, rows) {
        connection.execute({
          portal: this.portal,
          rows
        });
        if (!rows) {
          connection.sync();
        } else {
          connection.flush();
        }
      }
      // http://developer.postgresql.org/pgdocs/postgres/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
      prepare(connection) {
        if (!this.hasBeenParsed(connection)) {
          connection.parse({
            text: this.text,
            name: this.name,
            types: this.types
          });
        }
        try {
          connection.bind({
            portal: this.portal,
            statement: this.name,
            values: this.values,
            binary: this.binary,
            valueMapper: utils.prepareValue
          });
        } catch (err) {
          connection.close({ type: "S", name: this.name });
          connection.sync();
          this.handleError(err, connection);
          return;
        }
        connection.describe({
          type: "P",
          name: this.portal || ""
        });
        this._getRows(connection, this.rows);
      }
      handleCopyInResponse(connection) {
        connection.sendCopyFail("No source stream defined");
      }
      handleCopyData(msg, connection) {
      }
    };
    module.exports = Query2;
  }
});

// ../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/messages.js
var require_messages = __commonJS({
  "../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/messages.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoticeMessage = exports.DataRowMessage = exports.CommandCompleteMessage = exports.ReadyForQueryMessage = exports.NotificationResponseMessage = exports.BackendKeyDataMessage = exports.AuthenticationMD5Password = exports.ParameterStatusMessage = exports.ParameterDescriptionMessage = exports.RowDescriptionMessage = exports.Field = exports.CopyResponse = exports.CopyDataMessage = exports.DatabaseError = exports.copyDone = exports.emptyQuery = exports.replicationStart = exports.portalSuspended = exports.noData = exports.closeComplete = exports.bindComplete = exports.parseComplete = void 0;
    exports.parseComplete = {
      name: "parseComplete",
      length: 5
    };
    exports.bindComplete = {
      name: "bindComplete",
      length: 5
    };
    exports.closeComplete = {
      name: "closeComplete",
      length: 5
    };
    exports.noData = {
      name: "noData",
      length: 5
    };
    exports.portalSuspended = {
      name: "portalSuspended",
      length: 5
    };
    exports.replicationStart = {
      name: "replicationStart",
      length: 4
    };
    exports.emptyQuery = {
      name: "emptyQuery",
      length: 4
    };
    exports.copyDone = {
      name: "copyDone",
      length: 4
    };
    var DatabaseError2 = class extends Error {
      constructor(message, length, name) {
        super(message);
        this.length = length;
        this.name = name;
      }
    };
    exports.DatabaseError = DatabaseError2;
    var CopyDataMessage = class {
      constructor(length, chunk) {
        this.length = length;
        this.chunk = chunk;
        this.name = "copyData";
      }
    };
    exports.CopyDataMessage = CopyDataMessage;
    var CopyResponse = class {
      constructor(length, name, binary, columnCount) {
        this.length = length;
        this.name = name;
        this.binary = binary;
        this.columnTypes = new Array(columnCount);
      }
    };
    exports.CopyResponse = CopyResponse;
    var Field = class {
      constructor(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, format) {
        this.name = name;
        this.tableID = tableID;
        this.columnID = columnID;
        this.dataTypeID = dataTypeID;
        this.dataTypeSize = dataTypeSize;
        this.dataTypeModifier = dataTypeModifier;
        this.format = format;
      }
    };
    exports.Field = Field;
    var RowDescriptionMessage = class {
      constructor(length, fieldCount) {
        this.length = length;
        this.fieldCount = fieldCount;
        this.name = "rowDescription";
        this.fields = new Array(this.fieldCount);
      }
    };
    exports.RowDescriptionMessage = RowDescriptionMessage;
    var ParameterDescriptionMessage = class {
      constructor(length, parameterCount) {
        this.length = length;
        this.parameterCount = parameterCount;
        this.name = "parameterDescription";
        this.dataTypeIDs = new Array(this.parameterCount);
      }
    };
    exports.ParameterDescriptionMessage = ParameterDescriptionMessage;
    var ParameterStatusMessage = class {
      constructor(length, parameterName, parameterValue) {
        this.length = length;
        this.parameterName = parameterName;
        this.parameterValue = parameterValue;
        this.name = "parameterStatus";
      }
    };
    exports.ParameterStatusMessage = ParameterStatusMessage;
    var AuthenticationMD5Password = class {
      constructor(length, salt) {
        this.length = length;
        this.salt = salt;
        this.name = "authenticationMD5Password";
      }
    };
    exports.AuthenticationMD5Password = AuthenticationMD5Password;
    var BackendKeyDataMessage = class {
      constructor(length, processID, secretKey) {
        this.length = length;
        this.processID = processID;
        this.secretKey = secretKey;
        this.name = "backendKeyData";
      }
    };
    exports.BackendKeyDataMessage = BackendKeyDataMessage;
    var NotificationResponseMessage = class {
      constructor(length, processId, channel, payload) {
        this.length = length;
        this.processId = processId;
        this.channel = channel;
        this.payload = payload;
        this.name = "notification";
      }
    };
    exports.NotificationResponseMessage = NotificationResponseMessage;
    var ReadyForQueryMessage = class {
      constructor(length, status) {
        this.length = length;
        this.status = status;
        this.name = "readyForQuery";
      }
    };
    exports.ReadyForQueryMessage = ReadyForQueryMessage;
    var CommandCompleteMessage = class {
      constructor(length, text) {
        this.length = length;
        this.text = text;
        this.name = "commandComplete";
      }
    };
    exports.CommandCompleteMessage = CommandCompleteMessage;
    var DataRowMessage = class {
      constructor(length, fields) {
        this.length = length;
        this.fields = fields;
        this.name = "dataRow";
        this.fieldCount = fields.length;
      }
    };
    exports.DataRowMessage = DataRowMessage;
    var NoticeMessage = class {
      constructor(length, message) {
        this.length = length;
        this.message = message;
        this.name = "notice";
      }
    };
    exports.NoticeMessage = NoticeMessage;
  }
});

// ../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-writer.js
var require_buffer_writer = __commonJS({
  "../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-writer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Writer = void 0;
    var Writer = class {
      constructor(size = 256) {
        this.size = size;
        this.offset = 5;
        this.headerPosition = 0;
        this.buffer = Buffer.allocUnsafe(size);
      }
      ensure(size) {
        const remaining = this.buffer.length - this.offset;
        if (remaining < size) {
          const oldBuffer = this.buffer;
          const newSize = oldBuffer.length + (oldBuffer.length >> 1) + size;
          this.buffer = Buffer.allocUnsafe(newSize);
          oldBuffer.copy(this.buffer);
        }
      }
      addInt32(num) {
        this.ensure(4);
        this.buffer[this.offset++] = num >>> 24 & 255;
        this.buffer[this.offset++] = num >>> 16 & 255;
        this.buffer[this.offset++] = num >>> 8 & 255;
        this.buffer[this.offset++] = num >>> 0 & 255;
        return this;
      }
      addInt16(num) {
        this.ensure(2);
        this.buffer[this.offset++] = num >>> 8 & 255;
        this.buffer[this.offset++] = num >>> 0 & 255;
        return this;
      }
      addCString(string) {
        if (!string) {
          this.ensure(1);
        } else {
          const len = Buffer.byteLength(string);
          this.ensure(len + 1);
          this.buffer.write(string, this.offset, "utf-8");
          this.offset += len;
        }
        this.buffer[this.offset++] = 0;
        return this;
      }
      addString(string = "") {
        const len = Buffer.byteLength(string);
        this.ensure(len);
        this.buffer.write(string, this.offset);
        this.offset += len;
        return this;
      }
      // Write an Int32 byte-length prefix immediately followed by the string's UTF-8
      // bytes. Postgres' Bind wire format prefixes every parameter with its length,
      // and doing it in one method computes Buffer.byteLength ONCE — the previous
      // `addInt32(Buffer.byteLength(s)).addString(s)` pairing scanned the string
      // three times (byteLength for the prefix, byteLength again inside addString,
      // then the encode), which is costly for large text parameters.
      addInt32PrefixedString(string) {
        const len = Buffer.byteLength(string);
        this.ensure(4 + len);
        const buffer = this.buffer;
        let offset = this.offset;
        buffer[offset++] = len >>> 24 & 255;
        buffer[offset++] = len >>> 16 & 255;
        buffer[offset++] = len >>> 8 & 255;
        buffer[offset++] = len >>> 0 & 255;
        buffer.write(string, offset, "utf-8");
        this.offset = offset + len;
        return this;
      }
      add(otherBuffer) {
        this.ensure(otherBuffer.length);
        otherBuffer.copy(this.buffer, this.offset);
        this.offset += otherBuffer.length;
        return this;
      }
      join(code) {
        if (code) {
          this.buffer[this.headerPosition] = code;
          const length = this.offset - (this.headerPosition + 1);
          this.buffer.writeInt32BE(length, this.headerPosition + 1);
        }
        return this.buffer.slice(code ? 0 : 5, this.offset);
      }
      flush(code) {
        const result = this.join(code);
        this.offset = 5;
        this.headerPosition = 0;
        this.buffer = Buffer.allocUnsafe(this.size);
        return result;
      }
      clear() {
        this.offset = 5;
        this.headerPosition = 0;
      }
    };
    exports.Writer = Writer;
  }
});

// ../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/serializer.js
var require_serializer = __commonJS({
  "../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/serializer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.serialize = void 0;
    var buffer_writer_1 = require_buffer_writer();
    var writer = new buffer_writer_1.Writer();
    var startup = (opts) => {
      writer.addInt16(3).addInt16(0);
      for (const key of Object.keys(opts)) {
        writer.addCString(key).addCString(opts[key]);
      }
      writer.addCString("client_encoding").addCString("UTF8");
      const bodyBuffer = writer.addCString("").flush();
      const length = bodyBuffer.length + 4;
      return new buffer_writer_1.Writer().addInt32(length).add(bodyBuffer).flush();
    };
    var requestSsl = () => {
      const response = Buffer.allocUnsafe(8);
      response.writeInt32BE(8, 0);
      response.writeInt32BE(80877103, 4);
      return response;
    };
    var password = (password2) => {
      return writer.addCString(password2).flush(
        112
        /* code.startup */
      );
    };
    var sendSASLInitialResponseMessage = function(mechanism, initialResponse) {
      writer.addCString(mechanism).addInt32PrefixedString(initialResponse);
      return writer.flush(
        112
        /* code.startup */
      );
    };
    var sendSCRAMClientFinalMessage = function(additionalData) {
      return writer.addString(additionalData).flush(
        112
        /* code.startup */
      );
    };
    var query = (text) => {
      return writer.addCString(text).flush(
        81
        /* code.query */
      );
    };
    var emptyArray = [];
    var parse = (query2) => {
      const name = query2.name || "";
      if (name.length > 63) {
        console.error("Warning! Postgres only supports 63 characters for query names.");
        console.error("You supplied %s (%s)", name, name.length);
        console.error("This can cause conflicts and silent errors executing queries");
      }
      const types2 = query2.types || emptyArray;
      const len = types2.length;
      const buffer = writer.addCString(name).addCString(query2.text).addInt16(len);
      for (let i = 0; i < len; i++) {
        buffer.addInt32(types2[i]);
      }
      return writer.flush(
        80
        /* code.parse */
      );
    };
    var paramWriter = new buffer_writer_1.Writer();
    var writeValues = function(values, valueMapper) {
      for (let i = 0; i < values.length; i++) {
        const mappedVal = valueMapper ? valueMapper(values[i], i) : values[i];
        if (mappedVal == null) {
          writer.addInt16(
            0
            /* ParamType.STRING */
          );
          paramWriter.addInt32(-1);
        } else if (mappedVal instanceof Buffer) {
          writer.addInt16(
            1
            /* ParamType.BINARY */
          );
          paramWriter.addInt32(mappedVal.length);
          paramWriter.add(mappedVal);
        } else {
          writer.addInt16(
            0
            /* ParamType.STRING */
          );
          paramWriter.addInt32PrefixedString(mappedVal);
        }
      }
    };
    var bind = (config = {}) => {
      const portal = config.portal || "";
      const statement = config.statement || "";
      const binary = config.binary || false;
      const values = config.values || emptyArray;
      const len = values.length;
      writer.addCString(portal).addCString(statement);
      writer.addInt16(len);
      try {
        writeValues(values, config.valueMapper);
      } catch (err) {
        writer.clear();
        paramWriter.clear();
        throw err;
      }
      writer.addInt16(len);
      writer.add(paramWriter.flush());
      writer.addInt16(1);
      writer.addInt16(
        binary ? 1 : 0
        /* ParamType.STRING */
      );
      return writer.flush(
        66
        /* code.bind */
      );
    };
    var emptyExecute = Buffer.from([69, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
    var execute = (config) => {
      if (!config || !config.portal && !config.rows) {
        return emptyExecute;
      }
      const portal = config.portal || "";
      const rows = config.rows || 0;
      const portalLength = Buffer.byteLength(portal);
      const len = 4 + portalLength + 1 + 4;
      const buff = Buffer.allocUnsafe(1 + len);
      buff[0] = 69;
      buff.writeInt32BE(len, 1);
      buff.write(portal, 5, "utf-8");
      buff[portalLength + 5] = 0;
      buff.writeUInt32BE(rows, buff.length - 4);
      return buff;
    };
    var cancel = (processID, secretKey) => {
      const buffer = Buffer.allocUnsafe(16);
      buffer.writeInt32BE(16, 0);
      buffer.writeInt16BE(1234, 4);
      buffer.writeInt16BE(5678, 6);
      buffer.writeInt32BE(processID, 8);
      buffer.writeInt32BE(secretKey, 12);
      return buffer;
    };
    var cstringMessage = (code, string) => {
      const stringLen = Buffer.byteLength(string);
      const len = 4 + stringLen + 1;
      const buffer = Buffer.allocUnsafe(1 + len);
      buffer[0] = code;
      buffer.writeInt32BE(len, 1);
      buffer.write(string, 5, "utf-8");
      buffer[len] = 0;
      return buffer;
    };
    var emptyDescribePortal = writer.addCString("P").flush(
      68
      /* code.describe */
    );
    var emptyDescribeStatement = writer.addCString("S").flush(
      68
      /* code.describe */
    );
    var describe = (msg) => {
      return msg.name ? cstringMessage(68, `${msg.type}${msg.name || ""}`) : msg.type === "P" ? emptyDescribePortal : emptyDescribeStatement;
    };
    var close = (msg) => {
      const text = `${msg.type}${msg.name || ""}`;
      return cstringMessage(67, text);
    };
    var copyData = (chunk) => {
      return writer.add(chunk).flush(
        100
        /* code.copyFromChunk */
      );
    };
    var copyFail = (message) => {
      return cstringMessage(102, message);
    };
    var codeOnlyBuffer = (code) => Buffer.from([code, 0, 0, 0, 4]);
    var flushBuffer = codeOnlyBuffer(
      72
      /* code.flush */
    );
    var syncBuffer = codeOnlyBuffer(
      83
      /* code.sync */
    );
    var endBuffer = codeOnlyBuffer(
      88
      /* code.end */
    );
    var copyDoneBuffer = codeOnlyBuffer(
      99
      /* code.copyDone */
    );
    var serialize = {
      startup,
      password,
      requestSsl,
      sendSASLInitialResponseMessage,
      sendSCRAMClientFinalMessage,
      query,
      parse,
      bind,
      execute,
      describe,
      close,
      flush: () => flushBuffer,
      sync: () => syncBuffer,
      end: () => endBuffer,
      copyData,
      copyDone: () => copyDoneBuffer,
      copyFail,
      cancel
    };
    exports.serialize = serialize;
  }
});

// ../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-reader.js
var require_buffer_reader = __commonJS({
  "../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-reader.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BufferReader = void 0;
    var BufferReader = class {
      constructor(offset = 0) {
        this.offset = offset;
        this.buffer = Buffer.allocUnsafe(0);
        this.encoding = "utf-8";
      }
      setBuffer(offset, buffer) {
        this.offset = offset;
        this.buffer = buffer;
      }
      int16() {
        const result = this.buffer.readInt16BE(this.offset);
        this.offset += 2;
        return result;
      }
      byte() {
        const result = this.buffer[this.offset];
        this.offset++;
        return result;
      }
      int32() {
        const result = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return result;
      }
      uint32() {
        const result = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return result;
      }
      string(length) {
        const result = this.buffer.toString(this.encoding, this.offset, this.offset + length);
        this.offset += length;
        return result;
      }
      cstring() {
        const start = this.offset;
        let end = start;
        while (this.buffer[end++]) {
        }
        this.offset = end;
        return this.buffer.toString(this.encoding, start, end - 1);
      }
      bytes(length) {
        const result = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return result;
      }
    };
    exports.BufferReader = BufferReader;
  }
});

// ../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js
var require_parser = __commonJS({
  "../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Parser = void 0;
    var messages_1 = require_messages();
    var buffer_reader_1 = require_buffer_reader();
    var CODE_LENGTH = 1;
    var LEN_LENGTH = 4;
    var HEADER_LENGTH = CODE_LENGTH + LEN_LENGTH;
    var LATEINIT_LENGTH = -1;
    var emptyBuffer = Buffer.allocUnsafe(0);
    var Parser = class {
      constructor(opts) {
        this.buffer = emptyBuffer;
        this.bufferLength = 0;
        this.bufferOffset = 0;
        this.reader = new buffer_reader_1.BufferReader();
        if ((opts === null || opts === void 0 ? void 0 : opts.mode) === "binary") {
          throw new Error("Binary mode not supported yet");
        }
        this.mode = (opts === null || opts === void 0 ? void 0 : opts.mode) || "text";
      }
      parse(buffer, callback) {
        this.mergeBuffer(buffer);
        const bufferFullLength = this.bufferOffset + this.bufferLength;
        let offset = this.bufferOffset;
        while (offset + HEADER_LENGTH <= bufferFullLength) {
          const code = this.buffer[offset];
          const length = this.buffer.readUInt32BE(offset + CODE_LENGTH);
          const fullMessageLength = CODE_LENGTH + length;
          if (fullMessageLength + offset <= bufferFullLength) {
            const message = this.handlePacket(offset + HEADER_LENGTH, code, length, this.buffer);
            callback(message);
            offset += fullMessageLength;
          } else {
            break;
          }
        }
        if (offset === bufferFullLength) {
          this.buffer = emptyBuffer;
          this.bufferLength = 0;
          this.bufferOffset = 0;
        } else {
          this.bufferLength = bufferFullLength - offset;
          this.bufferOffset = offset;
        }
      }
      mergeBuffer(buffer) {
        if (this.bufferLength > 0) {
          const newLength = this.bufferLength + buffer.byteLength;
          const newFullLength = newLength + this.bufferOffset;
          if (newFullLength > this.buffer.byteLength) {
            let newBuffer;
            if (newLength <= this.buffer.byteLength && this.bufferOffset >= this.bufferLength) {
              newBuffer = this.buffer;
            } else {
              let newBufferLength = this.buffer.byteLength * 2;
              while (newLength >= newBufferLength) {
                newBufferLength *= 2;
              }
              newBuffer = Buffer.allocUnsafe(newBufferLength);
            }
            this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset + this.bufferLength);
            this.buffer = newBuffer;
            this.bufferOffset = 0;
          }
          buffer.copy(this.buffer, this.bufferOffset + this.bufferLength);
          this.bufferLength = newLength;
        } else {
          this.buffer = buffer;
          this.bufferOffset = 0;
          this.bufferLength = buffer.byteLength;
        }
      }
      handlePacket(offset, code, length, bytes) {
        const { reader } = this;
        reader.setBuffer(offset, bytes);
        let message;
        switch (code) {
          case 50:
            message = messages_1.bindComplete;
            break;
          case 49:
            message = messages_1.parseComplete;
            break;
          case 51:
            message = messages_1.closeComplete;
            break;
          case 110:
            message = messages_1.noData;
            break;
          case 115:
            message = messages_1.portalSuspended;
            break;
          case 99:
            message = messages_1.copyDone;
            break;
          case 87:
            message = messages_1.replicationStart;
            break;
          case 73:
            message = messages_1.emptyQuery;
            break;
          case 68:
            message = parseDataRowMessage(reader);
            break;
          case 67:
            message = parseCommandCompleteMessage(reader);
            break;
          case 90:
            message = parseReadyForQueryMessage(reader);
            break;
          case 65:
            message = parseNotificationMessage(reader);
            break;
          case 82:
            message = parseAuthenticationResponse(reader, length);
            break;
          case 83:
            message = parseParameterStatusMessage(reader);
            break;
          case 75:
            message = parseBackendKeyData(reader);
            break;
          case 69:
            message = parseErrorMessage(reader, "error");
            break;
          case 78:
            message = parseErrorMessage(reader, "notice");
            break;
          case 84:
            message = parseRowDescriptionMessage(reader);
            break;
          case 116:
            message = parseParameterDescriptionMessage(reader);
            break;
          case 71:
            message = parseCopyInMessage(reader);
            break;
          case 72:
            message = parseCopyOutMessage(reader);
            break;
          case 100:
            message = parseCopyData(reader, length);
            break;
          default:
            return new messages_1.DatabaseError("received invalid response: " + code.toString(16), length, "error");
        }
        reader.setBuffer(0, emptyBuffer);
        message.length = length;
        return message;
      }
    };
    exports.Parser = Parser;
    var parseReadyForQueryMessage = (reader) => {
      const status = reader.string(1);
      return new messages_1.ReadyForQueryMessage(LATEINIT_LENGTH, status);
    };
    var parseCommandCompleteMessage = (reader) => {
      const text = reader.cstring();
      return new messages_1.CommandCompleteMessage(LATEINIT_LENGTH, text);
    };
    var parseCopyData = (reader, length) => {
      const chunk = reader.bytes(length - 4);
      return new messages_1.CopyDataMessage(LATEINIT_LENGTH, chunk);
    };
    var parseCopyInMessage = (reader) => parseCopyMessage(reader, "copyInResponse");
    var parseCopyOutMessage = (reader) => parseCopyMessage(reader, "copyOutResponse");
    var parseCopyMessage = (reader, messageName) => {
      const isBinary = reader.byte() !== 0;
      const columnCount = reader.int16();
      const message = new messages_1.CopyResponse(LATEINIT_LENGTH, messageName, isBinary, columnCount);
      for (let i = 0; i < columnCount; i++) {
        message.columnTypes[i] = reader.int16();
      }
      return message;
    };
    var parseNotificationMessage = (reader) => {
      const processId = reader.int32();
      const channel = reader.cstring();
      const payload = reader.cstring();
      return new messages_1.NotificationResponseMessage(LATEINIT_LENGTH, processId, channel, payload);
    };
    var parseRowDescriptionMessage = (reader) => {
      const fieldCount = reader.int16();
      const message = new messages_1.RowDescriptionMessage(LATEINIT_LENGTH, fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        message.fields[i] = parseField(reader);
      }
      return message;
    };
    var parseField = (reader) => {
      const name = reader.cstring();
      const tableID = reader.uint32();
      const columnID = reader.int16();
      const dataTypeID = reader.uint32();
      const dataTypeSize = reader.int16();
      const dataTypeModifier = reader.int32();
      const mode = reader.int16() === 0 ? "text" : "binary";
      return new messages_1.Field(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, mode);
    };
    var parseParameterDescriptionMessage = (reader) => {
      const parameterCount = reader.int16();
      const message = new messages_1.ParameterDescriptionMessage(LATEINIT_LENGTH, parameterCount);
      for (let i = 0; i < parameterCount; i++) {
        message.dataTypeIDs[i] = reader.int32();
      }
      return message;
    };
    var parseDataRowMessage = (reader) => {
      const fieldCount = reader.int16();
      const fields = new Array(fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        const len = reader.int32();
        fields[i] = len === -1 ? null : reader.string(len);
      }
      return new messages_1.DataRowMessage(LATEINIT_LENGTH, fields);
    };
    var parseParameterStatusMessage = (reader) => {
      const name = reader.cstring();
      const value = reader.cstring();
      return new messages_1.ParameterStatusMessage(LATEINIT_LENGTH, name, value);
    };
    var parseBackendKeyData = (reader) => {
      const processID = reader.int32();
      const secretKey = reader.int32();
      return new messages_1.BackendKeyDataMessage(LATEINIT_LENGTH, processID, secretKey);
    };
    var parseAuthenticationResponse = (reader, length) => {
      const code = reader.int32();
      const message = {
        name: "authenticationOk",
        length
      };
      switch (code) {
        case 0:
          break;
        case 3:
          if (message.length === 8) {
            message.name = "authenticationCleartextPassword";
          }
          break;
        case 5:
          if (message.length === 12) {
            message.name = "authenticationMD5Password";
            const salt = reader.bytes(4);
            return new messages_1.AuthenticationMD5Password(LATEINIT_LENGTH, salt);
          }
          break;
        case 10:
          {
            message.name = "authenticationSASL";
            message.mechanisms = [];
            let mechanism;
            do {
              mechanism = reader.cstring();
              if (mechanism) {
                message.mechanisms.push(mechanism);
              }
            } while (mechanism);
          }
          break;
        case 11:
          message.name = "authenticationSASLContinue";
          message.data = reader.string(length - 8);
          break;
        case 12:
          message.name = "authenticationSASLFinal";
          message.data = reader.string(length - 8);
          break;
        default:
          throw new Error("Unknown authenticationOk message type " + code);
      }
      return message;
    };
    var parseErrorMessage = (reader, name) => {
      const fields = {};
      let fieldType = reader.string(1);
      while (fieldType !== "\0") {
        fields[fieldType] = reader.cstring();
        fieldType = reader.string(1);
      }
      const messageValue = fields.M;
      const message = name === "notice" ? new messages_1.NoticeMessage(LATEINIT_LENGTH, messageValue) : new messages_1.DatabaseError(messageValue, LATEINIT_LENGTH, name);
      message.severity = fields.S;
      message.code = fields.C;
      message.detail = fields.D;
      message.hint = fields.H;
      message.position = fields.P;
      message.internalPosition = fields.p;
      message.internalQuery = fields.q;
      message.where = fields.W;
      message.schema = fields.s;
      message.table = fields.t;
      message.column = fields.c;
      message.dataType = fields.d;
      message.constraint = fields.n;
      message.file = fields.F;
      message.line = fields.L;
      message.routine = fields.R;
      return message;
    };
  }
});

// ../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js
var require_dist = __commonJS({
  "../../node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DatabaseError = exports.serialize = void 0;
    exports.parse = parse;
    var messages_1 = require_messages();
    Object.defineProperty(exports, "DatabaseError", { enumerable: true, get: function() {
      return messages_1.DatabaseError;
    } });
    var serializer_1 = require_serializer();
    Object.defineProperty(exports, "serialize", { enumerable: true, get: function() {
      return serializer_1.serialize;
    } });
    var parser_1 = require_parser();
    function parse(stream, callback) {
      const parser = new parser_1.Parser();
      stream.on("data", (buffer) => parser.parse(buffer, callback));
      return new Promise((resolve) => stream.on("end", () => resolve()));
    }
  }
});

// ../../node_modules/.pnpm/pg-cloudflare@1.4.0/node_modules/pg-cloudflare/dist/empty.js
var require_empty = __commonJS({
  "../../node_modules/.pnpm/pg-cloudflare@1.4.0/node_modules/pg-cloudflare/dist/empty.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = {};
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/stream.js
var require_stream = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/stream.js"(exports, module) {
    var { getStream, getSecureStream } = getStreamFuncs();
    module.exports = {
      /**
       * Get a socket stream compatible with the current runtime environment.
       * @returns {Duplex}
       */
      getStream,
      /**
       * Get a TLS secured socket, compatible with the current environment,
       * using the socket and other settings given in `options`.
       * @returns {Duplex}
       */
      getSecureStream
    };
    function getNodejsStreamFuncs() {
      function getStream2(ssl) {
        const net = __require("net");
        return new net.Socket();
      }
      function getSecureStream2(options) {
        const tls = __require("tls");
        return tls.connect(options);
      }
      return {
        getStream: getStream2,
        getSecureStream: getSecureStream2
      };
    }
    function getCloudflareStreamFuncs() {
      function getStream2(ssl) {
        const { CloudflareSocket } = require_empty();
        return new CloudflareSocket(ssl);
      }
      function getSecureStream2(options) {
        options.socket.startTls(options);
        return options.socket;
      }
      return {
        getStream: getStream2,
        getSecureStream: getSecureStream2
      };
    }
    function isCloudflareRuntime() {
      if (typeof navigator === "object" && navigator !== null && typeof navigator.userAgent === "string") {
        return navigator.userAgent === "Cloudflare-Workers";
      }
      if (typeof Response === "function") {
        const resp = new Response(null, { cf: { thing: true } });
        if (typeof resp.cf === "object" && resp.cf !== null && resp.cf.thing) {
          return true;
        }
      }
      return false;
    }
    function getStreamFuncs() {
      if (isCloudflareRuntime()) {
        return getCloudflareStreamFuncs();
      }
      return getNodejsStreamFuncs();
    }
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection.js
var require_connection = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var { parse, serialize } = require_dist();
    var stream = require_stream();
    var { getStream } = stream;
    var flushBuffer = serialize.flush();
    var syncBuffer = serialize.sync();
    var endBuffer = serialize.end();
    var Connection2 = class extends EventEmitter {
      constructor(config) {
        super();
        config = config || {};
        this.stream = config.stream || getStream(config.ssl);
        if (typeof this.stream === "function") {
          this.stream = this.stream(config);
        }
        this._keepAlive = config.keepAlive;
        this._keepAliveInitialDelayMillis = config.keepAliveInitialDelayMillis;
        this.parsedStatements = {};
        this.ssl = config.ssl || false;
        this.sslNegotiation = config.sslNegotiation || "postgres";
        this._ending = false;
        this._emitMessage = false;
        const self2 = this;
        this.on("newListener", function(eventName) {
          if (eventName === "message") {
            self2._emitMessage = true;
          }
        });
      }
      connect(port, host) {
        const self2 = this;
        this._connecting = true;
        this.stream.setNoDelay(true);
        this.stream.connect(port, host);
        this.stream.once("connect", function() {
          if (self2._keepAlive) {
            self2.stream.setKeepAlive(true, self2._keepAliveInitialDelayMillis);
          }
          self2.emit("connect");
        });
        const reportStreamError = function(error) {
          if (self2._ending && (error.code === "ECONNRESET" || error.code === "EPIPE")) {
            return;
          }
          self2.emit("error", error);
        };
        this.stream.on("error", reportStreamError);
        this.stream.on("close", function() {
          self2.emit("end");
        });
        if (!this.ssl) {
          return this.attachListeners(this.stream);
        }
        if (this.sslNegotiation === "direct") {
          return this.stream.once("connect", function() {
            self2.upgradeToSSL(host, reportStreamError);
          });
        }
        this.stream.once("data", function(buffer) {
          const responseCode = buffer.toString("utf8");
          switch (responseCode) {
            case "S":
              break;
            case "N":
              self2.stream.end();
              return self2.emit("error", new Error("The server does not support SSL connections"));
            default:
              self2.stream.end();
              return self2.emit("error", new Error("There was an error establishing an SSL connection"));
          }
          self2.upgradeToSSL(host, reportStreamError);
        });
      }
      upgradeToSSL(host, reportStreamError) {
        const self2 = this;
        const options = {
          socket: self2.stream
        };
        if (self2.ssl !== true) {
          Object.assign(options, self2.ssl);
          if ("key" in self2.ssl) {
            options.key = self2.ssl.key;
          }
        }
        if (self2.sslNegotiation === "direct") {
          options.ALPNProtocols = ["postgresql"];
        }
        const net = __require("net");
        if (net.isIP && net.isIP(host) === 0) {
          options.servername = host;
        }
        try {
          self2.stream = stream.getSecureStream(options);
        } catch (err) {
          return self2.emit("error", err);
        }
        self2.attachListeners(self2.stream);
        self2.stream.on("error", reportStreamError);
        self2.emit("sslconnect");
      }
      attachListeners(stream2) {
        parse(stream2, (msg) => {
          const eventName = msg.name === "error" ? "errorMessage" : msg.name;
          if (this._emitMessage) {
            this.emit("message", msg);
          }
          this.emit(eventName, msg);
        });
      }
      requestSsl() {
        this.stream.write(serialize.requestSsl());
      }
      startup(config) {
        this.stream.write(serialize.startup(config));
      }
      cancel(processID, secretKey) {
        this._send(serialize.cancel(processID, secretKey));
      }
      password(password) {
        this._send(serialize.password(password));
      }
      sendSASLInitialResponseMessage(mechanism, initialResponse) {
        this._send(serialize.sendSASLInitialResponseMessage(mechanism, initialResponse));
      }
      sendSCRAMClientFinalMessage(additionalData) {
        this._send(serialize.sendSCRAMClientFinalMessage(additionalData));
      }
      _send(buffer) {
        if (!this.stream.writable) {
          return false;
        }
        return this.stream.write(buffer);
      }
      query(text) {
        this._send(serialize.query(text));
      }
      // send parse message
      parse(query) {
        this._send(serialize.parse(query));
      }
      // send bind message
      bind(config) {
        this._send(serialize.bind(config));
      }
      // send execute message
      execute(config) {
        this._send(serialize.execute(config));
      }
      flush() {
        if (this.stream.writable) {
          this.stream.write(flushBuffer);
        }
      }
      sync() {
        this._ending = true;
        this._send(syncBuffer);
      }
      ref() {
        this.stream.ref();
      }
      unref() {
        this.stream.unref();
      }
      end() {
        this._ending = true;
        if (!this._connecting || !this.stream.writable) {
          this.stream.end();
          return;
        }
        return this.stream.write(endBuffer, () => {
          this.stream.end();
        });
      }
      close(msg) {
        this._send(serialize.close(msg));
      }
      describe(msg) {
        this._send(serialize.describe(msg));
      }
      sendCopyFromChunk(chunk) {
        this._send(serialize.copyData(chunk));
      }
      endCopyFrom() {
        this._send(serialize.copyDone());
      }
      sendCopyFail(msg) {
        this._send(serialize.copyFail(msg));
      }
    };
    module.exports = Connection2;
  }
});

// ../../node_modules/.pnpm/split2@4.2.0/node_modules/split2/index.js
var require_split2 = __commonJS({
  "../../node_modules/.pnpm/split2@4.2.0/node_modules/split2/index.js"(exports, module) {
    "use strict";
    var { Transform } = __require("stream");
    var { StringDecoder } = __require("string_decoder");
    var kLast = Symbol("last");
    var kDecoder = Symbol("decoder");
    function transform(chunk, enc, cb) {
      let list;
      if (this.overflow) {
        const buf = this[kDecoder].write(chunk);
        list = buf.split(this.matcher);
        if (list.length === 1) return cb();
        list.shift();
        this.overflow = false;
      } else {
        this[kLast] += this[kDecoder].write(chunk);
        list = this[kLast].split(this.matcher);
      }
      this[kLast] = list.pop();
      for (let i = 0; i < list.length; i++) {
        try {
          push(this, this.mapper(list[i]));
        } catch (error) {
          return cb(error);
        }
      }
      this.overflow = this[kLast].length > this.maxLength;
      if (this.overflow && !this.skipOverflow) {
        cb(new Error("maximum buffer reached"));
        return;
      }
      cb();
    }
    function flush(cb) {
      this[kLast] += this[kDecoder].end();
      if (this[kLast]) {
        try {
          push(this, this.mapper(this[kLast]));
        } catch (error) {
          return cb(error);
        }
      }
      cb();
    }
    function push(self2, val) {
      if (val !== void 0) {
        self2.push(val);
      }
    }
    function noop(incoming) {
      return incoming;
    }
    function split(matcher, mapper, options) {
      matcher = matcher || /\r?\n/;
      mapper = mapper || noop;
      options = options || {};
      switch (arguments.length) {
        case 1:
          if (typeof matcher === "function") {
            mapper = matcher;
            matcher = /\r?\n/;
          } else if (typeof matcher === "object" && !(matcher instanceof RegExp) && !matcher[Symbol.split]) {
            options = matcher;
            matcher = /\r?\n/;
          }
          break;
        case 2:
          if (typeof matcher === "function") {
            options = mapper;
            mapper = matcher;
            matcher = /\r?\n/;
          } else if (typeof mapper === "object") {
            options = mapper;
            mapper = noop;
          }
      }
      options = Object.assign({}, options);
      options.autoDestroy = true;
      options.transform = transform;
      options.flush = flush;
      options.readableObjectMode = true;
      const stream = new Transform(options);
      stream[kLast] = "";
      stream[kDecoder] = new StringDecoder("utf8");
      stream.matcher = matcher;
      stream.mapper = mapper;
      stream.maxLength = options.maxLength;
      stream.skipOverflow = options.skipOverflow || false;
      stream.overflow = false;
      stream._destroy = function(err, cb) {
        this._writableState.errorEmitted = false;
        cb(err);
      };
      return stream;
    }
    module.exports = split;
  }
});

// ../../node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/helper.js
var require_helper = __commonJS({
  "../../node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/helper.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var Stream = __require("stream").Stream;
    var split = require_split2();
    var util = __require("util");
    var defaultPort = 5432;
    var isWin = process.platform === "win32";
    var warnStream = process.stderr;
    var S_IRWXG = 56;
    var S_IRWXO = 7;
    var S_IFMT = 61440;
    var S_IFREG = 32768;
    function isRegFile(mode) {
      return (mode & S_IFMT) == S_IFREG;
    }
    var fieldNames = ["host", "port", "database", "user", "password"];
    var nrOfFields = fieldNames.length;
    var passKey = fieldNames[nrOfFields - 1];
    function warn() {
      var isWritable = warnStream instanceof Stream && true === warnStream.writable;
      if (isWritable) {
        var args = Array.prototype.slice.call(arguments).concat("\n");
        warnStream.write(util.format.apply(util, args));
      }
    }
    Object.defineProperty(module.exports, "isWin", {
      get: function() {
        return isWin;
      },
      set: function(val) {
        isWin = val;
      }
    });
    module.exports.warnTo = function(stream) {
      var old = warnStream;
      warnStream = stream;
      return old;
    };
    module.exports.getFileName = function(rawEnv) {
      var env = rawEnv || process.env;
      var file = env.PGPASSFILE || (isWin ? path.join(env.APPDATA || "./", "postgresql", "pgpass.conf") : path.join(env.HOME || "./", ".pgpass"));
      return file;
    };
    module.exports.usePgPass = function(stats, fname) {
      if (Object.prototype.hasOwnProperty.call(process.env, "PGPASSWORD")) {
        return false;
      }
      if (isWin) {
        return true;
      }
      fname = fname || "<unkn>";
      if (!isRegFile(stats.mode)) {
        warn('WARNING: password file "%s" is not a plain file', fname);
        return false;
      }
      if (stats.mode & (S_IRWXG | S_IRWXO)) {
        warn('WARNING: password file "%s" has group or world access; permissions should be u=rw (0600) or less', fname);
        return false;
      }
      return true;
    };
    var matcher = module.exports.match = function(connInfo, entry) {
      return fieldNames.slice(0, -1).reduce(function(prev, field, idx) {
        if (idx == 1) {
          if (Number(connInfo[field] || defaultPort) === Number(entry[field])) {
            return prev && true;
          }
        }
        return prev && (entry[field] === "*" || entry[field] === connInfo[field]);
      }, true);
    };
    module.exports.getPassword = function(connInfo, stream, cb) {
      var pass;
      var lineStream = stream.pipe(split());
      function onLine(line) {
        var entry = parseLine(line);
        if (entry && isValidEntry(entry) && matcher(connInfo, entry)) {
          pass = entry[passKey];
          lineStream.end();
        }
      }
      var onEnd = function() {
        stream.destroy();
        cb(pass);
      };
      var onErr = function(err) {
        stream.destroy();
        warn("WARNING: error on reading file: %s", err);
        cb(void 0);
      };
      stream.on("error", onErr);
      lineStream.on("data", onLine).on("end", onEnd).on("error", onErr);
    };
    var parseLine = module.exports.parseLine = function(line) {
      if (line.length < 11 || line.match(/^\s+#/)) {
        return null;
      }
      var curChar = "";
      var prevChar = "";
      var fieldIdx = 0;
      var startIdx = 0;
      var endIdx = 0;
      var obj = {};
      var isLastField = false;
      var addToObj = function(idx, i0, i1) {
        var field = line.substring(i0, i1);
        if (!Object.hasOwnProperty.call(process.env, "PGPASS_NO_DEESCAPE")) {
          field = field.replace(/\\([:\\])/g, "$1");
        }
        obj[fieldNames[idx]] = field;
      };
      for (var i = 0; i < line.length - 1; i += 1) {
        curChar = line.charAt(i + 1);
        prevChar = line.charAt(i);
        isLastField = fieldIdx == nrOfFields - 1;
        if (isLastField) {
          addToObj(fieldIdx, startIdx);
          break;
        }
        if (i >= 0 && curChar == ":" && prevChar !== "\\") {
          addToObj(fieldIdx, startIdx, i + 1);
          startIdx = i + 2;
          fieldIdx += 1;
        }
      }
      obj = Object.keys(obj).length === nrOfFields ? obj : null;
      return obj;
    };
    var isValidEntry = module.exports.isValidEntry = function(entry) {
      var rules = {
        // host
        0: function(x) {
          return x.length > 0;
        },
        // port
        1: function(x) {
          if (x === "*") {
            return true;
          }
          x = Number(x);
          return isFinite(x) && x > 0 && x < 9007199254740992 && Math.floor(x) === x;
        },
        // database
        2: function(x) {
          return x.length > 0;
        },
        // username
        3: function(x) {
          return x.length > 0;
        },
        // password
        4: function(x) {
          return x.length > 0;
        }
      };
      for (var idx = 0; idx < fieldNames.length; idx += 1) {
        var rule = rules[idx];
        var value = entry[fieldNames[idx]] || "";
        var res = rule(value);
        if (!res) {
          return false;
        }
      }
      return true;
    };
  }
});

// ../../node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/index.js
var require_lib = __commonJS({
  "../../node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/index.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = __require("fs");
    var helper = require_helper();
    module.exports = function(connInfo, cb) {
      var file = helper.getFileName();
      fs.stat(file, function(err, stat) {
        if (err || !helper.usePgPass(stat, file)) {
          return cb(void 0);
        }
        var st = fs.createReadStream(file);
        helper.getPassword(connInfo, st, cb);
      });
    };
    module.exports.warnTo = helper.warnTo;
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js
var require_client = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js"(exports, module) {
    var EventEmitter = __require("events").EventEmitter;
    var utils = require_utils();
    var nodeUtils = __require("util");
    var sasl = require_sasl();
    var TypeOverrides2 = require_type_overrides();
    var ConnectionParameters = require_connection_parameters();
    var Query2 = require_query();
    var defaults2 = require_defaults();
    var Connection2 = require_connection();
    var crypto = require_utils2();
    var activeQueryDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Client.activeQuery is deprecated and will be removed in pg@9.0"
    );
    var queryQueueDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Client.queryQueue is deprecated and will be removed in pg@9.0."
    );
    var pgPassDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "pgpass support is deprecated and will be removed in pg@9.0. You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code."
    );
    var byoPromiseDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Passing a custom Promise implementation to the Client/Pool constructor is deprecated and will be removed in pg@9.0."
    );
    var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead."
    );
    function coerceNumberOrDefault(value, defaultValue) {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : defaultValue;
      }
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : defaultValue;
      }
      return defaultValue;
    }
    var Client2 = class extends EventEmitter {
      constructor(config) {
        super();
        this.connectionParameters = new ConnectionParameters(config);
        this.user = this.connectionParameters.user;
        this.database = this.connectionParameters.database;
        this.port = this.connectionParameters.port;
        this.host = this.connectionParameters.host;
        Object.defineProperty(this, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: this.connectionParameters.password
        });
        this.replication = this.connectionParameters.replication;
        const c = config || {};
        if (c.Promise) {
          byoPromiseDeprecationNotice();
        }
        this._Promise = c.Promise || global.Promise;
        this._types = new TypeOverrides2(c.types);
        this._ending = false;
        this._ended = false;
        this._connecting = false;
        this._connected = false;
        this._connectionError = false;
        this._queryable = true;
        this._activeQuery = null;
        this._txStatus = null;
        this.enableChannelBinding = Boolean(c.enableChannelBinding);
        this.scramMaxIterations = coerceNumberOrDefault(c.scramMaxIterations, sasl.DEFAULT_MAX_SCRAM_ITERATIONS);
        this.connection = c.connection || new Connection2({
          stream: c.stream,
          ssl: this.connectionParameters.ssl,
          sslNegotiation: this.connectionParameters.sslnegotiation,
          keepAlive: c.keepAlive || false,
          keepAliveInitialDelayMillis: c.keepAliveInitialDelayMillis || 0,
          encoding: this.connectionParameters.client_encoding || "utf8"
        });
        this._queryQueue = [];
        this.binary = c.binary || defaults2.binary;
        this.processID = null;
        this.secretKey = null;
        this.ssl = this.connectionParameters.ssl || false;
        this.sslNegotiation = this.connectionParameters.sslnegotiation || "postgres";
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this._connectionTimeoutMillis = c.connectionTimeoutMillis || 0;
      }
      get activeQuery() {
        activeQueryDeprecationNotice();
        return this._activeQuery;
      }
      set activeQuery(val) {
        activeQueryDeprecationNotice();
        this._activeQuery = val;
      }
      _getActiveQuery() {
        return this._activeQuery;
      }
      _errorAllQueries(err) {
        const enqueueError = (query) => {
          process.nextTick(() => {
            query.handleError(err, this.connection);
          });
        };
        const activeQuery = this._getActiveQuery();
        if (activeQuery) {
          enqueueError(activeQuery);
          this._activeQuery = null;
        }
        this._queryQueue.forEach(enqueueError);
        this._queryQueue.length = 0;
      }
      _connect(callback) {
        const self2 = this;
        const con = this.connection;
        this._connectionCallback = callback;
        if (this._connecting || this._connected) {
          const err = new Error("Client has already been connected. You cannot reuse a client.");
          process.nextTick(() => {
            callback(err);
          });
          return;
        }
        this._connecting = true;
        if (this._connectionTimeoutMillis > 0) {
          this.connectionTimeoutHandle = setTimeout(() => {
            con._ending = true;
            con.stream.destroy(new Error("timeout expired"));
          }, this._connectionTimeoutMillis);
          if (this.connectionTimeoutHandle.unref) {
            this.connectionTimeoutHandle.unref();
          }
        }
        if (this.host && this.host.indexOf("/") === 0) {
          con.connect(this.host + "/.s.PGSQL." + this.port);
        } else {
          con.connect(this.port, this.host);
        }
        con.on("connect", function() {
          if (self2.ssl) {
            if (self2.sslNegotiation !== "direct") {
              con.requestSsl();
            }
          } else {
            con.startup(self2.getStartupConf());
          }
        });
        con.on("sslconnect", function() {
          con.startup(self2.getStartupConf());
        });
        this._attachListeners(con);
        con.once("end", () => {
          const error = this._ending ? new Error("Connection terminated") : new Error("Connection terminated unexpectedly");
          clearTimeout(this.connectionTimeoutHandle);
          this._errorAllQueries(error);
          this._ended = true;
          if (!this._ending) {
            if (this._connecting && !this._connectionError) {
              if (this._connectionCallback) {
                this._connectionCallback(error);
              } else {
                this._handleErrorEvent(error);
              }
            } else if (!this._connectionError) {
              this._handleErrorEvent(error);
            }
          }
          process.nextTick(() => {
            this.emit("end");
          });
        });
      }
      connect(callback) {
        if (callback) {
          this._connect(callback);
          return;
        }
        return new this._Promise((resolve, reject) => {
          this._connect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve(this);
            }
          });
        });
      }
      _attachListeners(con) {
        con.on("authenticationCleartextPassword", this._handleAuthCleartextPassword.bind(this));
        con.on("authenticationMD5Password", this._handleAuthMD5Password.bind(this));
        con.on("authenticationSASL", this._handleAuthSASL.bind(this));
        con.on("authenticationSASLContinue", this._handleAuthSASLContinue.bind(this));
        con.on("authenticationSASLFinal", this._handleAuthSASLFinal.bind(this));
        con.on("backendKeyData", this._handleBackendKeyData.bind(this));
        con.on("error", this._handleErrorEvent.bind(this));
        con.on("errorMessage", this._handleErrorMessage.bind(this));
        con.on("readyForQuery", this._handleReadyForQuery.bind(this));
        con.on("notice", this._handleNotice.bind(this));
        con.on("rowDescription", this._handleRowDescription.bind(this));
        con.on("dataRow", this._handleDataRow.bind(this));
        con.on("portalSuspended", this._handlePortalSuspended.bind(this));
        con.on("emptyQuery", this._handleEmptyQuery.bind(this));
        con.on("commandComplete", this._handleCommandComplete.bind(this));
        con.on("parseComplete", this._handleParseComplete.bind(this));
        con.on("copyInResponse", this._handleCopyInResponse.bind(this));
        con.on("copyData", this._handleCopyData.bind(this));
        con.on("notification", this._handleNotification.bind(this));
      }
      _getPassword(cb) {
        const con = this.connection;
        if (typeof this.password === "function") {
          this._Promise.resolve().then(() => this.password(this.connectionParameters)).then((pass) => {
            if (pass !== void 0) {
              if (typeof pass !== "string") {
                con.emit("error", new TypeError("Password must be a string"));
                return;
              }
              this.connectionParameters.password = this.password = pass;
            } else {
              this.connectionParameters.password = this.password = null;
            }
            cb();
          }).catch((err) => {
            con.emit("error", err);
          });
        } else if (this.password !== null) {
          cb();
        } else {
          try {
            const pgPass = require_lib();
            pgPass(this.connectionParameters, (pass) => {
              if (void 0 !== pass) {
                pgPassDeprecationNotice();
                this.connectionParameters.password = this.password = pass;
              }
              cb();
            });
          } catch (e) {
            this.emit("error", e);
          }
        }
      }
      _handleAuthCleartextPassword(msg) {
        this._getPassword(() => {
          this.connection.password(this.password);
        });
      }
      _handleAuthMD5Password(msg) {
        this._getPassword(async () => {
          try {
            const hashedPassword = await crypto.postgresMd5PasswordHash(this.user, this.password, msg.salt);
            this.connection.password(hashedPassword);
          } catch (e) {
            this.emit("error", e);
          }
        });
      }
      _handleAuthSASL(msg) {
        this._getPassword(() => {
          try {
            this.saslSession = sasl.startSession(
              msg.mechanisms,
              this.enableChannelBinding && this.connection.stream,
              this.scramMaxIterations
            );
            this.connection.sendSASLInitialResponseMessage(this.saslSession.mechanism, this.saslSession.response);
          } catch (err) {
            this.connection.emit("error", err);
          }
        });
      }
      async _handleAuthSASLContinue(msg) {
        try {
          await sasl.continueSession(
            this.saslSession,
            this.password,
            msg.data,
            this.enableChannelBinding && this.connection.stream
          );
          this.connection.sendSCRAMClientFinalMessage(this.saslSession.response);
        } catch (err) {
          this.connection.emit("error", err);
        }
      }
      _handleAuthSASLFinal(msg) {
        try {
          sasl.finalizeSession(this.saslSession, msg.data);
          this.saslSession = null;
        } catch (err) {
          this.connection.emit("error", err);
        }
      }
      _handleBackendKeyData(msg) {
        this.processID = msg.processID;
        this.secretKey = msg.secretKey;
      }
      _handleReadyForQuery(msg) {
        if (this._connecting) {
          this._connecting = false;
          this._connected = true;
          clearTimeout(this.connectionTimeoutHandle);
          if (this._connectionCallback) {
            this._connectionCallback(null, this);
            this._connectionCallback = null;
          }
          this.emit("connect");
        }
        const activeQuery = this._getActiveQuery();
        this._activeQuery = null;
        this._txStatus = msg?.status ?? null;
        this.readyForQuery = true;
        if (activeQuery) {
          activeQuery.handleReadyForQuery(this.connection);
        }
        this._pulseQueryQueue();
      }
      // if we receive an error event or error message
      // during the connection process we handle it here
      _handleErrorWhileConnecting(err) {
        if (this._connectionError) {
          return;
        }
        this._connectionError = true;
        clearTimeout(this.connectionTimeoutHandle);
        if (this._connectionCallback) {
          return this._connectionCallback(err);
        }
        this.emit("error", err);
      }
      // if we're connected and we receive an error event from the connection
      // this means the socket is dead - do a hard abort of all queries and emit
      // the socket error on the client as well
      _handleErrorEvent(err) {
        if (this._connecting) {
          return this._handleErrorWhileConnecting(err);
        }
        this._queryable = false;
        this._errorAllQueries(err);
        this.emit("error", err);
      }
      // handle error messages from the postgres backend
      _handleErrorMessage(msg) {
        if (this._connecting) {
          return this._handleErrorWhileConnecting(msg);
        }
        const activeQuery = this._getActiveQuery();
        if (!activeQuery) {
          this._handleErrorEvent(msg);
          return;
        }
        this._activeQuery = null;
        activeQuery.handleError(msg, this.connection);
      }
      _handleRowDescription(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected rowDescription message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleRowDescription(msg);
      }
      _handleDataRow(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected dataRow message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleDataRow(msg);
      }
      _handlePortalSuspended(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected portalSuspended message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handlePortalSuspended(this.connection);
      }
      _handleEmptyQuery(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected emptyQuery message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleEmptyQuery(this.connection);
      }
      _handleCommandComplete(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected commandComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCommandComplete(msg, this.connection);
      }
      _handleParseComplete() {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected parseComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        if (activeQuery.name) {
          this.connection.parsedStatements[activeQuery.name] = activeQuery.text;
        }
      }
      _handleCopyInResponse(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected copyInResponse message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCopyInResponse(this.connection);
      }
      _handleCopyData(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected copyData message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCopyData(msg, this.connection);
      }
      _handleNotification(msg) {
        this.emit("notification", msg);
      }
      _handleNotice(msg) {
        this.emit("notice", msg);
      }
      getStartupConf() {
        const params = this.connectionParameters;
        const data = {
          user: params.user,
          database: params.database
        };
        const appName = params.application_name || params.fallback_application_name;
        if (appName) {
          data.application_name = appName;
        }
        if (params.replication) {
          data.replication = "" + params.replication;
        }
        if (params.statement_timeout) {
          data.statement_timeout = String(parseInt(params.statement_timeout, 10));
        }
        if (params.lock_timeout) {
          data.lock_timeout = String(parseInt(params.lock_timeout, 10));
        }
        if (params.idle_in_transaction_session_timeout) {
          data.idle_in_transaction_session_timeout = String(parseInt(params.idle_in_transaction_session_timeout, 10));
        }
        if (params.options) {
          data.options = params.options;
        }
        return data;
      }
      cancel(client, query) {
        if (client.activeQuery === query) {
          const con = this.connection;
          if (this.host && this.host.indexOf("/") === 0) {
            con.connect(this.host + "/.s.PGSQL." + this.port);
          } else {
            con.connect(this.port, this.host);
          }
          con.on("connect", function() {
            con.cancel(client.processID, client.secretKey);
          });
        } else if (client._queryQueue.indexOf(query) !== -1) {
          client._queryQueue.splice(client._queryQueue.indexOf(query), 1);
        }
      }
      setTypeParser(oid, format, parseFn) {
        return this._types.setTypeParser(oid, format, parseFn);
      }
      getTypeParser(oid, format) {
        return this._types.getTypeParser(oid, format);
      }
      // escapeIdentifier and escapeLiteral moved to utility functions & exported
      // on PG
      // re-exported here for backwards compatibility
      escapeIdentifier(str3) {
        return utils.escapeIdentifier(str3);
      }
      escapeLiteral(str3) {
        return utils.escapeLiteral(str3);
      }
      _pulseQueryQueue() {
        if (this.readyForQuery === true) {
          this._activeQuery = this._queryQueue.shift();
          const activeQuery = this._getActiveQuery();
          if (activeQuery) {
            this.readyForQuery = false;
            this.hasExecuted = true;
            const queryError = activeQuery.submit(this.connection);
            if (queryError) {
              process.nextTick(() => {
                activeQuery.handleError(queryError, this.connection);
                this.readyForQuery = true;
                this._pulseQueryQueue();
              });
            }
          } else if (this.hasExecuted) {
            this._activeQuery = null;
            this.emit("drain");
          }
        }
      }
      query(config, values, callback) {
        let query;
        let result;
        if (config == null) {
          throw new TypeError("Client was passed a null or undefined query");
        }
        if (typeof config.submit === "function") {
          result = query = config;
          if (!query.callback) {
            if (typeof values === "function") {
              query.callback = values;
            } else if (callback) {
              query.callback = callback;
            }
          }
        } else {
          query = new Query2(config, values, callback);
          if (!query.callback) {
            result = new this._Promise((resolve, reject) => {
              query.callback = (err, res) => err ? reject(err) : resolve(res);
            }).catch((err) => {
              Error.captureStackTrace(err);
              throw err;
            });
          } else if (typeof query.callback !== "function") {
            throw new TypeError("callback is not a function");
          }
        }
        const readTimeout = config.query_timeout || this.connectionParameters.query_timeout;
        if (readTimeout) {
          const queryCallback = query.callback || (() => {
          });
          const readTimeoutTimer = setTimeout(() => {
            const error = new Error("Query read timeout");
            process.nextTick(() => {
              query.handleError(error, this.connection);
            });
            queryCallback(error);
            query.callback = () => {
            };
            const index = this._queryQueue.indexOf(query);
            if (index > -1) {
              this._queryQueue.splice(index, 1);
            }
            this._pulseQueryQueue();
          }, readTimeout);
          query.callback = (err, res) => {
            clearTimeout(readTimeoutTimer);
            queryCallback(err, res);
          };
        }
        if (this.binary && !query.binary) {
          query.binary = true;
        }
        if (query._result && !query._result._types) {
          query._result._types = this._types;
        }
        if (!this._queryable) {
          process.nextTick(() => {
            query.handleError(new Error("Client has encountered a connection error and is not queryable"), this.connection);
          });
          return result;
        }
        if (this._ending) {
          process.nextTick(() => {
            query.handleError(new Error("Client was closed and is not queryable"), this.connection);
          });
          return result;
        }
        if (this._queryQueue.length > 0) {
          queryQueueLengthDeprecationNotice();
        }
        this._queryQueue.push(query);
        this._pulseQueryQueue();
        return result;
      }
      ref() {
        this.connection.ref();
      }
      unref() {
        this.connection.unref();
      }
      getTransactionStatus() {
        return this._txStatus;
      }
      end(cb) {
        this._ending = true;
        if (!this.connection._connecting || this._ended) {
          if (cb) {
            cb();
            return;
          } else {
            return this._Promise.resolve();
          }
        }
        if (this._getActiveQuery() || !this._queryable) {
          this.connection.stream.destroy();
        } else {
          this.connection.end();
        }
        if (cb) {
          this.connection.once("end", cb);
        } else {
          return new this._Promise((resolve) => {
            this.connection.once("end", resolve);
          });
        }
      }
      get queryQueue() {
        queryQueueDeprecationNotice();
        return this._queryQueue;
      }
    };
    Client2.Query = Query2;
    module.exports = Client2;
  }
});

// ../../node_modules/.pnpm/pg-pool@3.14.0_pg@8.22.0/node_modules/pg-pool/index.js
var require_pg_pool = __commonJS({
  "../../node_modules/.pnpm/pg-pool@3.14.0_pg@8.22.0/node_modules/pg-pool/index.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var NOOP = function() {
    };
    var removeWhere = (list, predicate) => {
      const i = list.findIndex(predicate);
      return i === -1 ? void 0 : list.splice(i, 1)[0];
    };
    var IdleItem = class {
      constructor(client, idleListener, timeoutId) {
        this.client = client;
        this.idleListener = idleListener;
        this.timeoutId = timeoutId;
      }
    };
    var PendingItem = class {
      constructor(callback) {
        this.callback = callback;
      }
    };
    function throwOnDoubleRelease() {
      throw new Error("Release called on client which has already been released to the pool.");
    }
    function promisify(Promise2, callback) {
      if (callback) {
        return { callback, result: void 0 };
      }
      let rej;
      let res;
      const cb = function(err, client) {
        err ? rej(err) : res(client);
      };
      const result = new Promise2(function(resolve, reject) {
        res = resolve;
        rej = reject;
      }).catch((err) => {
        Error.captureStackTrace(err);
        throw err;
      });
      return { callback: cb, result };
    }
    function makeIdleListener(pool, client) {
      return function idleListener(err) {
        err.client = client;
        client.removeListener("error", idleListener);
        client.on("error", () => {
          pool.log("additional client error after disconnection due to error", err);
        });
        pool._remove(client);
        pool.emit("error", err, client);
      };
    }
    var Pool2 = class extends EventEmitter {
      constructor(options, Client2) {
        super();
        this.options = Object.assign({}, options);
        if (options != null && "password" in options) {
          Object.defineProperty(this.options, "password", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: options.password
          });
        }
        if (options != null && options.ssl && options.ssl.key) {
          Object.defineProperty(this.options.ssl, "key", {
            enumerable: false
          });
        }
        this.options.max = this.options.max || this.options.poolSize || 10;
        this.options.min = this.options.min || 0;
        this.options.maxUses = this.options.maxUses || Infinity;
        this.options.allowExitOnIdle = this.options.allowExitOnIdle || false;
        this.options.maxLifetimeSeconds = this.options.maxLifetimeSeconds || 0;
        this.log = this.options.log || function() {
        };
        this.Client = this.options.Client || Client2 || require_lib2().Client;
        this.Promise = this.options.Promise || global.Promise;
        if (typeof this.options.idleTimeoutMillis === "undefined") {
          this.options.idleTimeoutMillis = 1e4;
        }
        this._clients = [];
        this._idle = [];
        this._expired = /* @__PURE__ */ new WeakSet();
        this._pendingQueue = [];
        this._endCallback = void 0;
        this.ending = false;
        this.ended = false;
      }
      _promiseTry(f) {
        const Promise2 = this.Promise;
        if (typeof Promise2.try === "function") {
          return Promise2.try(f);
        }
        return new Promise2((resolve) => resolve(f()));
      }
      _isFull() {
        return this._clients.length >= this.options.max;
      }
      _isAboveMin() {
        return this._clients.length > this.options.min;
      }
      _pulseQueue() {
        this.log("pulse queue");
        if (this.ended) {
          this.log("pulse queue ended");
          return;
        }
        if (this.ending) {
          this.log("pulse queue on ending");
          if (this._idle.length) {
            this._idle.slice().map((item) => {
              this._remove(item.client);
            });
          }
          if (!this._clients.length) {
            this.ended = true;
            this._endCallback();
          }
          return;
        }
        if (!this._pendingQueue.length) {
          this.log("no queued requests");
          return;
        }
        if (!this._idle.length && this._isFull()) {
          return;
        }
        const pendingItem = this._pendingQueue.shift();
        if (this._idle.length) {
          const idleItem = this._idle.pop();
          clearTimeout(idleItem.timeoutId);
          const client = idleItem.client;
          client.ref && client.ref();
          const idleListener = idleItem.idleListener;
          return this._acquireClient(client, pendingItem, idleListener, false);
        }
        if (!this._isFull()) {
          return this.newClient(pendingItem);
        }
        throw new Error("unexpected condition");
      }
      _remove(client, callback) {
        const removed = removeWhere(this._idle, (item) => item.client === client);
        if (removed !== void 0) {
          clearTimeout(removed.timeoutId);
        }
        this._clients = this._clients.filter((c) => c !== client);
        const context = this;
        client.end(() => {
          context.emit("remove", client);
          if (typeof callback === "function") {
            callback();
          }
        });
      }
      connect(cb) {
        if (this.ending) {
          const err = new Error("Cannot use a pool after calling end on the pool");
          return cb ? cb(err) : this.Promise.reject(err);
        }
        const response = promisify(this.Promise, cb);
        const result = response.result;
        if (this._isFull() || this._idle.length) {
          if (this._idle.length) {
            process.nextTick(() => this._pulseQueue());
          }
          if (!this.options.connectionTimeoutMillis) {
            this._pendingQueue.push(new PendingItem(response.callback));
            return result;
          }
          const queueCallback = (err, res, done) => {
            clearTimeout(tid);
            response.callback(err, res, done);
          };
          const pendingItem = new PendingItem(queueCallback);
          const tid = setTimeout(() => {
            removeWhere(this._pendingQueue, (i) => i.callback === queueCallback);
            pendingItem.timedOut = true;
            response.callback(new Error("timeout exceeded when trying to connect"));
          }, this.options.connectionTimeoutMillis);
          if (tid.unref) {
            tid.unref();
          }
          this._pendingQueue.push(pendingItem);
          return result;
        }
        this.newClient(new PendingItem(response.callback));
        return result;
      }
      newClient(pendingItem) {
        const client = new this.Client(this.options);
        this._clients.push(client);
        const idleListener = makeIdleListener(this, client);
        this.log("checking client timeout");
        let tid;
        let timeoutHit = false;
        if (this.options.connectionTimeoutMillis) {
          tid = setTimeout(() => {
            if (client.connection) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client.connection.stream.destroy();
            } else if (!client.isConnected()) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client.end();
            }
          }, this.options.connectionTimeoutMillis);
        }
        this.log("connecting new client");
        client.connect((err) => {
          if (tid) {
            clearTimeout(tid);
          }
          client.on("error", idleListener);
          if (err) {
            this.log("client failed to connect", err);
            this._clients = this._clients.filter((c) => c !== client);
            if (timeoutHit) {
              err = new Error("Connection terminated due to connection timeout", { cause: err });
            }
            this._pulseQueue();
            if (!pendingItem.timedOut) {
              pendingItem.callback(err, void 0, NOOP);
            }
          } else {
            this.log("new client connected");
            if (this.options.onConnect) {
              this._promiseTry(() => this.options.onConnect(client)).then(
                () => {
                  this._afterConnect(client, pendingItem, idleListener);
                },
                (hookErr) => {
                  this._clients = this._clients.filter((c) => c !== client);
                  client.end(() => {
                    this._pulseQueue();
                    if (!pendingItem.timedOut) {
                      pendingItem.callback(hookErr, void 0, NOOP);
                    }
                  });
                }
              );
              return;
            }
            return this._afterConnect(client, pendingItem, idleListener);
          }
        });
      }
      _afterConnect(client, pendingItem, idleListener) {
        if (this.options.maxLifetimeSeconds !== 0) {
          const maxLifetimeTimeout = setTimeout(() => {
            this.log("ending client due to expired lifetime");
            this._expired.add(client);
            const idleIndex = this._idle.findIndex((idleItem) => idleItem.client === client);
            if (idleIndex !== -1) {
              this._acquireClient(
                client,
                new PendingItem((err, client2, clientRelease) => clientRelease()),
                idleListener,
                false
              );
            }
          }, this.options.maxLifetimeSeconds * 1e3);
          maxLifetimeTimeout.unref();
          client.once("end", () => clearTimeout(maxLifetimeTimeout));
        }
        return this._acquireClient(client, pendingItem, idleListener, true);
      }
      // acquire a client for a pending work item
      _acquireClient(client, pendingItem, idleListener, isNew) {
        if (isNew) {
          this.emit("connect", client);
        }
        this.emit("acquire", client);
        client.release = this._releaseOnce(client, idleListener);
        client.removeListener("error", idleListener);
        if (!pendingItem.timedOut) {
          if (isNew && this.options.verify) {
            this.options.verify(client, (err) => {
              if (err) {
                client.release(err);
                return pendingItem.callback(err, void 0, NOOP);
              }
              pendingItem.callback(void 0, client, client.release);
            });
          } else {
            pendingItem.callback(void 0, client, client.release);
          }
        } else {
          if (isNew && this.options.verify) {
            this.options.verify(client, client.release);
          } else {
            client.release();
          }
        }
      }
      // returns a function that wraps _release and throws if called more than once
      _releaseOnce(client, idleListener) {
        let released = false;
        return (err) => {
          if (released) {
            throwOnDoubleRelease();
          }
          released = true;
          this._release(client, idleListener, err);
        };
      }
      // release a client back to the poll, include an error
      // to remove it from the pool
      _release(client, idleListener, err) {
        client.on("error", idleListener);
        client._poolUseCount = (client._poolUseCount || 0) + 1;
        this.emit("release", err, client);
        if (err || this.ending || !client._queryable || client._ending || client._poolUseCount >= this.options.maxUses) {
          if (client._poolUseCount >= this.options.maxUses) {
            this.log("remove expended client");
          }
          return this._remove(client, this._pulseQueue.bind(this));
        }
        const isExpired = this._expired.has(client);
        if (isExpired) {
          this.log("remove expired client");
          this._expired.delete(client);
          return this._remove(client, this._pulseQueue.bind(this));
        }
        let tid;
        if (this.options.idleTimeoutMillis && this._isAboveMin()) {
          tid = setTimeout(() => {
            if (this._isAboveMin()) {
              this.log("remove idle client");
              this._remove(client, this._pulseQueue.bind(this));
            }
          }, this.options.idleTimeoutMillis);
          if (this.options.allowExitOnIdle) {
            tid.unref();
          }
        }
        if (this.options.allowExitOnIdle) {
          client.unref();
        }
        this._idle.push(new IdleItem(client, idleListener, tid));
        this._pulseQueue();
      }
      query(text, values, cb) {
        if (typeof text === "function") {
          const response2 = promisify(this.Promise, text);
          setImmediate(function() {
            return response2.callback(new Error("Passing a function as the first parameter to pool.query is not supported"));
          });
          return response2.result;
        }
        if (typeof values === "function") {
          cb = values;
          values = void 0;
        }
        const response = promisify(this.Promise, cb);
        cb = response.callback;
        this.connect((err, client) => {
          if (err) {
            return cb(err);
          }
          let clientReleased = false;
          const onError = (err2) => {
            if (clientReleased) {
              return;
            }
            clientReleased = true;
            client.release(err2);
            cb(err2);
          };
          client.once("error", onError);
          this.log("dispatching query");
          try {
            client.query(text, values, (err2, res) => {
              this.log("query dispatched");
              client.removeListener("error", onError);
              if (clientReleased) {
                return;
              }
              clientReleased = true;
              client.release(err2);
              if (err2) {
                return cb(err2);
              }
              return cb(void 0, res);
            });
          } catch (err2) {
            client.release(err2);
            return cb(err2);
          }
        });
        return response.result;
      }
      end(cb) {
        this.log("ending");
        if (this.ending) {
          const err = new Error("Called end on pool more than once");
          return cb ? cb(err) : this.Promise.reject(err);
        }
        this.ending = true;
        const promised = promisify(this.Promise, cb);
        this._endCallback = promised.callback;
        this._pulseQueue();
        return promised.result;
      }
      get waitingCount() {
        return this._pendingQueue.length;
      }
      get idleCount() {
        return this._idle.length;
      }
      get expiredCount() {
        return this._clients.reduce((acc, client) => acc + (this._expired.has(client) ? 1 : 0), 0);
      }
      get totalCount() {
        return this._clients.length;
      }
    };
    module.exports = Pool2;
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/query.js
var require_query2 = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/query.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var utils = require_utils();
    var NativeQuery = module.exports = function(config, values, callback) {
      EventEmitter.call(this);
      config = utils.normalizeQueryConfig(config, values, callback);
      this.text = config.text;
      this.values = config.values;
      this.name = config.name;
      this.queryMode = config.queryMode;
      this.callback = config.callback;
      this.state = "new";
      this._arrayMode = config.rowMode === "array";
      this._emitRowEvents = false;
      this.on(
        "newListener",
        function(event) {
          if (event === "row") this._emitRowEvents = true;
        }.bind(this)
      );
    };
    util.inherits(NativeQuery, EventEmitter);
    var errorFieldMap = {
      sqlState: "code",
      statementPosition: "position",
      messagePrimary: "message",
      context: "where",
      schemaName: "schema",
      tableName: "table",
      columnName: "column",
      dataTypeName: "dataType",
      constraintName: "constraint",
      sourceFile: "file",
      sourceLine: "line",
      sourceFunction: "routine"
    };
    NativeQuery.prototype.handleError = function(err) {
      const fields = this.native.pq.resultErrorFields();
      if (fields) {
        for (const key in fields) {
          const normalizedFieldName = errorFieldMap[key] || key;
          err[normalizedFieldName] = fields[key];
        }
      }
      if (this.callback) {
        this.callback(err);
      } else {
        this.emit("error", err);
      }
      this.state = "error";
    };
    NativeQuery.prototype.then = function(onSuccess, onFailure) {
      return this._getPromise().then(onSuccess, onFailure);
    };
    NativeQuery.prototype.catch = function(callback) {
      return this._getPromise().catch(callback);
    };
    NativeQuery.prototype._getPromise = function() {
      if (this._promise) return this._promise;
      this._promise = new Promise(
        function(resolve, reject) {
          this._once("end", resolve);
          this._once("error", reject);
        }.bind(this)
      );
      return this._promise;
    };
    NativeQuery.prototype.submit = function(client) {
      this.state = "running";
      const self2 = this;
      this.native = client.native;
      client.native.arrayMode = this._arrayMode;
      let after = function(err, rows, results) {
        client.native.arrayMode = false;
        setImmediate(function() {
          self2.emit("_done");
        });
        if (err) {
          return self2.handleError(err);
        }
        if (self2._emitRowEvents) {
          if (results.length > 1) {
            rows.forEach((rowOfRows, i) => {
              rowOfRows.forEach((row) => {
                self2.emit("row", row, results[i]);
              });
            });
          } else {
            rows.forEach(function(row) {
              self2.emit("row", row, results);
            });
          }
        }
        self2.state = "end";
        self2.emit("end", results);
        if (self2.callback) {
          self2.callback(null, results);
        }
      };
      if (process.domain) {
        after = process.domain.bind(after);
      }
      if (this.name) {
        if (this.name.length > 63) {
          console.error("Warning! Postgres only supports 63 characters for query names.");
          console.error("You supplied %s (%s)", this.name, this.name.length);
          console.error("This can cause conflicts and silent errors executing queries");
        }
        const values = (this.values || []).map(utils.prepareValue);
        if (client.namedQueries[this.name]) {
          if (this.text && client.namedQueries[this.name] !== this.text) {
            const err = new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
            return after(err);
          }
          return client.native.execute(this.name, values, after);
        }
        return client.native.prepare(this.name, this.text, values.length, function(err) {
          if (err) return after(err);
          client.namedQueries[self2.name] = self2.text;
          return self2.native.execute(self2.name, values, after);
        });
      } else if (this.values) {
        if (!Array.isArray(this.values)) {
          const err = new Error("Query values must be an array");
          return after(err);
        }
        const vals = this.values.map(utils.prepareValue);
        client.native.query(this.text, vals, after);
      } else if (this.queryMode === "extended") {
        client.native.query(this.text, [], after);
      } else {
        client.native.query(this.text, after);
      }
    };
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/client.js
var require_client2 = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/client.js"(exports, module) {
    var nodeUtils = __require("util");
    var Native;
    try {
      Native = __require("pg-native");
    } catch (e) {
      throw e;
    }
    var TypeOverrides2 = require_type_overrides();
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var ConnectionParameters = require_connection_parameters();
    var NativeQuery = require_query2();
    var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead."
    );
    var Client2 = module.exports = function(config) {
      EventEmitter.call(this);
      config = config || {};
      this._Promise = config.Promise || global.Promise;
      this._types = new TypeOverrides2(config.types);
      this.native = new Native({
        types: this._types
      });
      this._queryQueue = [];
      this._ending = false;
      this._connecting = false;
      this._connected = false;
      this._queryable = true;
      const cp = this.connectionParameters = new ConnectionParameters(config);
      if (config.nativeConnectionString) cp.nativeConnectionString = config.nativeConnectionString;
      this.user = cp.user;
      Object.defineProperty(this, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: cp.password
      });
      this.database = cp.database;
      this.host = cp.host;
      this.port = cp.port;
      this.namedQueries = {};
    };
    Client2.Query = NativeQuery;
    util.inherits(Client2, EventEmitter);
    Client2.prototype._errorAllQueries = function(err) {
      const enqueueError = (query) => {
        process.nextTick(() => {
          query.native = this.native;
          query.handleError(err);
        });
      };
      if (this._hasActiveQuery()) {
        enqueueError(this._activeQuery);
        this._activeQuery = null;
      }
      this._queryQueue.forEach(enqueueError);
      this._queryQueue.length = 0;
    };
    Client2.prototype._connect = function(cb) {
      const self2 = this;
      if (this._connecting) {
        process.nextTick(() => cb(new Error("Client has already been connected. You cannot reuse a client.")));
        return;
      }
      this._connecting = true;
      this.connectionParameters.getLibpqConnectionString(function(err, conString) {
        if (self2.connectionParameters.nativeConnectionString) conString = self2.connectionParameters.nativeConnectionString;
        if (err) return cb(err);
        self2.native.connect(conString, function(err2) {
          if (err2) {
            self2.native.end();
            return cb(err2);
          }
          self2._connected = true;
          self2.native.on("error", function(err3) {
            self2._queryable = false;
            self2._errorAllQueries(err3);
            self2.emit("error", err3);
          });
          self2.native.on("notification", function(msg) {
            self2.emit("notification", {
              channel: msg.relname,
              payload: msg.extra
            });
          });
          self2.emit("connect");
          self2._pulseQueryQueue(true);
          cb(null, this);
        });
      });
    };
    Client2.prototype.connect = function(callback) {
      if (callback) {
        this._connect(callback);
        return;
      }
      return new this._Promise((resolve, reject) => {
        this._connect((error) => {
          if (error) {
            reject(error);
          } else {
            resolve(this);
          }
        });
      });
    };
    Client2.prototype.query = function(config, values, callback) {
      let query;
      let result;
      let readTimeout;
      let readTimeoutTimer;
      let queryCallback;
      if (config === null || config === void 0) {
        throw new TypeError("Client was passed a null or undefined query");
      } else if (typeof config.submit === "function") {
        readTimeout = config.query_timeout || this.connectionParameters.query_timeout;
        result = query = config;
        if (typeof values === "function") {
          config.callback = values;
        }
      } else {
        readTimeout = config.query_timeout || this.connectionParameters.query_timeout;
        query = new NativeQuery(config, values, callback);
        if (!query.callback) {
          let resolveOut, rejectOut;
          result = new this._Promise((resolve, reject) => {
            resolveOut = resolve;
            rejectOut = reject;
          }).catch((err) => {
            Error.captureStackTrace(err);
            throw err;
          });
          query.callback = (err, res) => err ? rejectOut(err) : resolveOut(res);
        }
      }
      if (readTimeout) {
        queryCallback = query.callback || (() => {
        });
        readTimeoutTimer = setTimeout(() => {
          const error = new Error("Query read timeout");
          process.nextTick(() => {
            query.handleError(error, this.connection);
          });
          queryCallback(error);
          query.callback = () => {
          };
          const index = this._queryQueue.indexOf(query);
          if (index > -1) {
            this._queryQueue.splice(index, 1);
          }
          this._pulseQueryQueue();
        }, readTimeout);
        query.callback = (err, res) => {
          clearTimeout(readTimeoutTimer);
          queryCallback(err, res);
        };
      }
      if (!this._queryable) {
        query.native = this.native;
        process.nextTick(() => {
          query.handleError(new Error("Client has encountered a connection error and is not queryable"));
        });
        return result;
      }
      if (this._ending) {
        query.native = this.native;
        process.nextTick(() => {
          query.handleError(new Error("Client was closed and is not queryable"));
        });
        return result;
      }
      if (this._queryQueue.length > 0) {
        queryQueueLengthDeprecationNotice();
      }
      this._queryQueue.push(query);
      this._pulseQueryQueue();
      return result;
    };
    Client2.prototype.end = function(cb) {
      const self2 = this;
      this._ending = true;
      if (this._connecting && !this._connected) {
        this.once("connect", () => {
          this.end(() => {
          });
        });
      }
      let result;
      if (!cb) {
        result = new this._Promise(function(resolve, reject) {
          cb = (err) => err ? reject(err) : resolve();
        });
      }
      this.native.end(function() {
        self2._connected = false;
        self2._errorAllQueries(new Error("Connection terminated"));
        process.nextTick(() => {
          self2.emit("end");
          if (cb) cb();
        });
      });
      return result;
    };
    Client2.prototype._hasActiveQuery = function() {
      return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
    };
    Client2.prototype._pulseQueryQueue = function(initialConnection) {
      if (!this._connected) {
        return;
      }
      if (this._hasActiveQuery()) {
        return;
      }
      const query = this._queryQueue.shift();
      if (!query) {
        if (!initialConnection) {
          this.emit("drain");
        }
        return;
      }
      this._activeQuery = query;
      query.submit(this);
      const self2 = this;
      query.once("_done", function() {
        self2._pulseQueryQueue();
      });
    };
    Client2.prototype.cancel = function(query) {
      if (this._activeQuery === query) {
        this.native.cancel(function() {
        });
      } else if (this._queryQueue.indexOf(query) !== -1) {
        this._queryQueue.splice(this._queryQueue.indexOf(query), 1);
      }
    };
    Client2.prototype.ref = function() {
    };
    Client2.prototype.unref = function() {
    };
    Client2.prototype.setTypeParser = function(oid, format, parseFn) {
      return this._types.setTypeParser(oid, format, parseFn);
    };
    Client2.prototype.getTypeParser = function(oid, format) {
      return this._types.getTypeParser(oid, format);
    };
    Client2.prototype.isConnected = function() {
      return this._connected;
    };
    Client2.prototype.getTransactionStatus = function() {
      return this.native.getTransactionStatus();
    };
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/index.js
var require_native = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/index.js"(exports, module) {
    "use strict";
    module.exports = require_client2();
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js
var require_lib2 = __commonJS({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js"(exports, module) {
    "use strict";
    var Client2 = require_client();
    var defaults2 = require_defaults();
    var Connection2 = require_connection();
    var Result2 = require_result();
    var utils = require_utils();
    var Pool2 = require_pg_pool();
    var TypeOverrides2 = require_type_overrides();
    var { DatabaseError: DatabaseError2 } = require_dist();
    var { escapeIdentifier: escapeIdentifier2, escapeLiteral: escapeLiteral2 } = require_utils();
    var poolFactory = (Client3) => {
      return class BoundPool extends Pool2 {
        constructor(options) {
          super(options, Client3);
        }
      };
    };
    var PG = function(clientConstructor2) {
      this.defaults = defaults2;
      this.Client = clientConstructor2;
      this.Query = this.Client.Query;
      this.Pool = poolFactory(this.Client);
      this._pools = [];
      this.Connection = Connection2;
      this.types = require_pg_types();
      this.DatabaseError = DatabaseError2;
      this.TypeOverrides = TypeOverrides2;
      this.escapeIdentifier = escapeIdentifier2;
      this.escapeLiteral = escapeLiteral2;
      this.Result = Result2;
      this.utils = utils;
    };
    var clientConstructor = Client2;
    var forceNative = false;
    try {
      forceNative = !!process.env.NODE_PG_FORCE_NATIVE;
    } catch {
    }
    if (forceNative) {
      clientConstructor = require_native();
    }
    module.exports = new PG(clientConstructor);
    Object.defineProperty(module.exports, "native", {
      configurable: true,
      enumerable: false,
      get() {
        let native = null;
        try {
          native = new PG(require_native());
        } catch (err) {
          if (err.code !== "MODULE_NOT_FOUND") {
            throw err;
          }
        }
        Object.defineProperty(module.exports, "native", {
          value: native
        });
        return native;
      }
    });
  }
});

// ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/esm/index.mjs
var import_lib, Client, Pool, Connection, types, Query, DatabaseError, escapeIdentifier, escapeLiteral, Result, TypeOverrides, defaults, esm_default;
var init_esm = __esm({
  "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/esm/index.mjs"() {
    import_lib = __toESM(require_lib2(), 1);
    Client = import_lib.default.Client;
    Pool = import_lib.default.Pool;
    Connection = import_lib.default.Connection;
    types = import_lib.default.types;
    Query = import_lib.default.Query;
    DatabaseError = import_lib.default.DatabaseError;
    escapeIdentifier = import_lib.default.escapeIdentifier;
    escapeLiteral = import_lib.default.escapeLiteral;
    Result = import_lib.default.Result;
    TypeOverrides = import_lib.default.TypeOverrides;
    defaults = import_lib.default.defaults;
    esm_default = import_lib.default;
  }
});

// src/hub-database.ts
import { createHash } from "node:crypto";
function hubDatabaseUrl(env = process.env) {
  const url = env[HUB_DB_URL_ENV];
  if (url === void 0 || url.trim() === "") {
    throw new Error(
      `${HUB_DB_URL_ENV} is not set. A Hub connects to the database it was told to and never to a default: a silent fallback points a Store's authority at whatever happens to answer on a well-known port. Fail closed.`
    );
  }
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      `${HUB_DB_URL_ENV} must point at a local development database (KL-INF-P1-037).`
    );
  }
  return url;
}
function isCanonicalIdempotencyKey(key) {
  return CANONICAL_IDEMPOTENCY_KEY_REGEX.test(key);
}
function parseIdempotencyKey(key) {
  const match = CANONICAL_IDEMPOTENCY_KEY_REGEX.exec(key);
  if (!match || match[1] === void 0 || match[2] === void 0) {
    throw new Error(
      `${HUB_IDEMPOTENCY_ERRORS.keyMalformed}: '${key}' is not kl1.{terminal_device_uuid}.{client_sequence}.`
    );
  }
  return { terminalDeviceId: match[1], clientSequence: BigInt(match[2]) };
}
function canonicalJson(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Canonical JSON cannot represent NaN or Infinity (RFC 8785).");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new Error("Convert bigint to a string before hashing (money contract \xA74).");
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`Canonical JSON cannot represent ${typeof value}.`);
  }
}
function canonicalRequestHash(request) {
  const material = [
    request.method.toUpperCase(),
    request.routeTemplate,
    canonicalJson(request.body),
    request.terminalDeviceId,
    request.sessionId,
    request.profileCode
  ].join("\n");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
var HUB_DB_URL_ENV, HUB_IDEMPOTENCY_ERRORS, UUID_PATTERN, CANONICAL_IDEMPOTENCY_KEY_REGEX;
var init_hub_database = __esm({
  "src/hub-database.ts"() {
    "use strict";
    HUB_DB_URL_ENV = "KITLUY_HUB_DB_URL";
    HUB_IDEMPOTENCY_ERRORS = {
      payloadMismatch: "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH",
      keyMalformed: "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      replayRejected: "EDGE_SEQUENCE_REPLAY_REJECTED",
      sequenceGap: "EDGE_SEQUENCE_GAP",
      versionConflict: "EDGE_AGGREGATE_VERSION_CONFLICT",
      scopeMismatch: "EDGE_SCOPE_MISMATCH",
      terminalUnknown: "EDGE_TERMINAL_UNKNOWN"
    };
    UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    CANONICAL_IDEMPOTENCY_KEY_REGEX = new RegExp(`^kl1\\.(${UUID_PATTERN})\\.([0-9]{1,20})$`);
  }
});

// src/hub/db.ts
function createHubPool(env = process.env, max = 8) {
  return new esm_default.Pool({ connectionString: hubDatabaseUrl(env), max });
}
async function isHubDatabaseReachable(env = process.env) {
  let pool;
  try {
    pool = new esm_default.Pool({
      connectionString: hubDatabaseUrl(env),
      max: 1,
      connectionTimeoutMillis: 2e3
    });
  } catch {
    return false;
  }
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => void 0);
  }
}
async function assumeRole(client, role) {
  try {
    await client.query(`set local role ${role}`);
    return true;
  } catch (error) {
    if (error?.code !== "42501") throw error;
    if (!roleFallbackWarned) {
      roleFallbackWarned = true;
      console.warn(
        `kitluy-hub-agent: cannot 'set local role ${role}' (insufficient_privilege). Running as the connected user; the schema contract \xA73 GRANT surface is NOT exercised. Grant the role to the connecting user to restore it.`
      );
    }
    return false;
  }
}
async function runInTransaction(pool, begin, fn, role) {
  const client = await pool.connect();
  try {
    await client.query(begin);
    await assumeRole(client, role);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}
async function withHubTransaction(pool, fn, role = HUB_RUNTIME_ROLE) {
  return runInTransaction(pool, "begin", fn, role);
}
async function withSerializableHubTransaction(pool, fn, role = HUB_RUNTIME_ROLE) {
  return runInTransaction(pool, "begin isolation level serializable", fn, role);
}
function isSerializationFailure(error) {
  const code = error?.code;
  return code === "40001" || code === "40P01";
}
var HUB_RUNTIME_ROLE, roleFallbackWarned;
var init_db = __esm({
  "src/hub/db.ts"() {
    "use strict";
    init_esm();
    init_hub_database();
    esm_default.types.setTypeParser(20, (value) => BigInt(value));
    HUB_RUNTIME_ROLE = "kitluy_hub_runtime";
    roleFallbackWarned = false;
  }
});

// src/hub/repositories/audit.ts
var audit_exports = {};
__export(audit_exports, {
  appendAuditEvent: () => appendAuditEvent,
  countSecurityEvents: () => countSecurityEvents,
  listAuditEventsForResource: () => listAuditEventsForResource,
  recordSecurityEvent: () => recordSecurityEvent
});
async function appendAuditEvent(client, input) {
  await client.query(
    `insert into edge_audit.audit_event
       (id, tenant_id, digital_store_id, location_id, event_code, actor_type, actor_id,
        requester_id, approver_id, terminal_device_id, hub_device_id, profile_code,
        resource_type, resource_id, reason_code, correlation_id, occurred_at,
        payload_sha256, details_json, local_sequence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             now(), $17, $18::jsonb, $19)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.eventCode,
      input.actorType,
      input.actorId,
      input.requesterId,
      input.approverId,
      input.terminalDeviceId,
      input.hubDeviceId,
      input.profileCode,
      input.resourceType,
      input.resourceId,
      input.reasonCode,
      input.correlationId,
      input.payloadSha256,
      JSON.stringify(input.details),
      input.localSequence.toString()
    ]
  );
}
async function listAuditEventsForResource(client, resourceId) {
  const result = await client.query(
    `select id, event_code, actor_id, requester_id, approver_id, resource_type,
            resource_id, correlation_id, local_sequence, details_json
       from edge_audit.audit_event where resource_id = $1 order by local_sequence`,
    [resourceId]
  );
  return result.rows;
}
async function recordSecurityEvent(client, input) {
  await client.query(
    `insert into edge_audit.security_event
       (id, tenant_id, digital_store_id, location_id, event_code, severity, device_id,
        certificate_serial, detected_at, details_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9::jsonb)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.eventCode,
      input.severity,
      input.deviceId,
      input.certificateSerial,
      JSON.stringify(input.details)
    ]
  );
}
async function countSecurityEvents(client, eventCode) {
  const result = await client.query(
    `select count(*)::text as count from edge_audit.security_event where event_code = $1`,
    [eventCode]
  );
  return Number(result.rows[0]?.count ?? "0");
}
var init_audit = __esm({
  "src/hub/repositories/audit.ts"() {
    "use strict";
  }
});

// src/hub/errors.ts
function fromDatabaseError(error) {
  const message = error?.message;
  if (typeof message !== "string") return void 0;
  for (const code of HUB_COMMAND_ERROR_CODES) {
    if (message.startsWith(`${code}:`)) {
      return new HubCommandError(code, message.slice(code.length + 1).trim());
    }
  }
  return void 0;
}
var HUB_COMMAND_ERROR_CODES, HubCommandError;
var init_errors = __esm({
  "src/hub/errors.ts"() {
    "use strict";
    HUB_COMMAND_ERROR_CODES = [
      // --- offline contract §19 -------------------------------------------------
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH",
      /** WS-09-T004 vocabulary for the same fact as EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH. */
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      "EDGE_SEQUENCE_REPLAY_REJECTED",
      "EDGE_SEQUENCE_GAP",
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      "EDGE_SCOPE_MISMATCH",
      "EDGE_TERMINAL_UNKNOWN",
      // --- authorisation dimensions (fail closed, one code per dimension) -------
      "EDGE_DEVICE_CONTEXT_INVALID",
      "EDGE_DEVICE_NOT_ASSIGNED",
      "EDGE_DEVICE_REVOKED",
      "EDGE_ASSIGNMENT_GENERATION_MISMATCH",
      "EDGE_SESSION_INVALID",
      "EDGE_SESSION_EXPIRED",
      "EDGE_PROFILE_NOT_AUTHORIZED",
      "EDGE_PERMISSION_DENIED",
      /** KLREQ-015: the route carries a `[REQUIRED: ...]` marker and stays INACTIVE. */
      "EDGE_PERMISSION_KEY_UNREGISTERED",
      "EDGE_RESOURCE_SCOPE_DENIED",
      "EDGE_ENVIRONMENT_DENIED",
      "EDGE_APPROVAL_REQUIRED",
      "EDGE_SELF_APPROVAL_FORBIDDEN",
      // --- business/engine refusals --------------------------------------------
      "EDGE_AGGREGATE_NOT_FOUND",
      "EDGE_INVALID_TRANSITION",
      "EDGE_PAYMENT_GATE_BLOCKED",
      "EDGE_CUSTODY_GATE_BLOCKED",
      "EDGE_CONFIGURATION_MISSING",
      "EDGE_REQUIRED_VALUE_MISSING",
      "EDGE_COMMAND_UNKNOWN",
      "EDGE_COMMAND_INACTIVE"
    ];
    HubCommandError = class extends Error {
      constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.code = code;
        this.details = details;
        this.name = "HubCommandError";
      }
    };
  }
});

// src/hub/repositories/sync.ts
var sync_exports = {};
__export(sync_exports, {
  WS09_DELIVERY_STATE: () => WS09_DELIVERY_STATE,
  WS09_WIRE_SYNC_STATE: () => WS09_WIRE_SYNC_STATE,
  allocateHubSequence: () => allocateHubSequence,
  assertWs09DeliveryState: () => assertWs09DeliveryState,
  countPendingOutbox: () => countPendingOutbox,
  findOutboxEntry: () => findOutboxEntry,
  findSyncCursor: () => findSyncCursor,
  insertLocalEventWithOutbox: () => insertLocalEventWithOutbox,
  listLocalEventsForAggregate: () => listLocalEventsForAggregate,
  recordSequenceGap: () => recordSequenceGap
});
async function allocateHubSequence(client) {
  const result = await client.query(
    `select edge_sync.allocate_hub_sequence()`
  );
  const value = result.rows[0]?.allocate_hub_sequence;
  if (value === void 0) {
    throw new Error("edge_sync.allocate_hub_sequence() returned no row.");
  }
  return value;
}
async function insertLocalEventWithOutbox(client, input) {
  await client.query(
    `insert into edge_sync.local_event
       (id, tenant_id, digital_store_id, location_id, hub_device_id, origin_device_id,
        actor_id, aggregate_type, aggregate_id, aggregate_version, event_type,
        schema_version, business_date, occurred_at, hub_sequence, origin_sequence,
        assignment_generation, idempotency_key, payload_sha256, payload, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, now(),
             $14, $15, $16, $17, $18, $19::jsonb, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.hubDeviceId,
      input.originDeviceId,
      input.actorId,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion.toString(),
      input.eventType,
      input.schemaVersion,
      input.businessDate,
      input.hubSequence.toString(),
      input.originSequence.toString(),
      input.assignmentGeneration,
      input.idempotencyKey,
      input.payloadSha256,
      JSON.stringify(input.payload)
    ]
  );
  await client.query(
    `insert into edge_sync.outbox
       (event_id, tenant_id, digital_store_id, location_id, hub_sequence,
        assignment_generation, delivery_state, attempt_count, next_attempt_at)
     values ($1, $2, $3, $4, $5, $6, $7::edge_sync.delivery_state, 0, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.hubSequence.toString(),
      input.assignmentGeneration,
      WS09_DELIVERY_STATE
    ]
  );
}
async function listLocalEventsForAggregate(client, aggregateId) {
  const result = await client.query(
    `select id, aggregate_type, aggregate_id, aggregate_version, event_type,
            schema_version, hub_sequence, origin_sequence, assignment_generation,
            idempotency_key, payload_sha256, payload
       from edge_sync.local_event where aggregate_id = $1 order by hub_sequence`,
    [aggregateId]
  );
  return result.rows;
}
async function findOutboxEntry(client, eventId) {
  const result = await client.query(
    `select event_id, hub_sequence, assignment_generation, delivery_state,
            attempt_count, cloud_ack_id, acknowledged_at
       from edge_sync.outbox where event_id = $1`,
    [eventId]
  );
  return result.rows[0];
}
async function countPendingOutbox(client, locationId) {
  const result = await client.query(
    `select count(*)::text as count from edge_sync.outbox
      where location_id = $1 and delivery_state = 'pending'`,
    [locationId]
  );
  return Number(result.rows[0]?.count ?? "0");
}
function assertWs09DeliveryState(state) {
  if (state !== WS09_DELIVERY_STATE) {
    throw new HubCommandError(
      "EDGE_COMMAND_INACTIVE",
      `WS-09 may only write delivery_state '${WS09_DELIVERY_STATE}'; '${state}' belongs to WS-10 (amendment \xA72).`,
      { deliveryState: state }
    );
  }
}
async function recordSequenceGap(client, input) {
  await client.query(
    `select edge_sync.record_sequence_gap($1::uuid, $2::uuid, $3::uuid, $4::uuid,
              $5::integer, $6::bigint, $7::text, $8::text, $9::text)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.assignmentGeneration,
      input.hubSequence.toString(),
      input.gapReason,
      input.recordedBy,
      input.note
    ]
  );
}
async function findSyncCursor(client, locationId, streamCode) {
  const result = await client.query(
    `select location_id, stream_code, last_pushed_hub_sequence, last_acked_hub_sequence,
            last_pulled_cloud_sequence, last_applied_cloud_sequence
       from edge_sync.sync_cursor where location_id = $1 and stream_code = $2`,
    [locationId, streamCode]
  );
  return result.rows[0];
}
var WS09_DELIVERY_STATE, WS09_WIRE_SYNC_STATE;
var init_sync = __esm({
  "src/hub/repositories/sync.ts"() {
    "use strict";
    init_errors();
    WS09_DELIVERY_STATE = "pending";
    WS09_WIRE_SYNC_STATE = "pending_cloud_sync";
  }
});

// ../../packages/device-identity/dist/environments.js
var init_environments = __esm({
  "../../packages/device-identity/dist/environments.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/errors.js
var PKI_BLOCKER_REF, RequiredCryptographicValueError;
var init_errors2 = __esm({
  "../../packages/device-identity/dist/errors.js"() {
    "use strict";
    PKI_BLOCKER_REF = "BLK-005";
    RequiredCryptographicValueError = class extends Error {
      code = "KLUY-DEVICE-PKI-UNCONFIGURED";
      blockerRef;
      requiredValue;
      environment;
      constructor(requiredValue, environment, blockerRef = PKI_BLOCKER_REF) {
        super(`KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: ${requiredValue}]` + (environment === void 0 ? "" : ` for environment ${environment}`) + ` \u2014 ${blockerRef} is OPEN. Certificate issuance, key custody, activation and production signing are refused until the owner rules ${blockerRef} and the approved design is implemented, tested and independently reviewed.`);
        this.name = "RequiredCryptographicValueError";
        this.blockerRef = blockerRef;
        this.requiredValue = requiredValue;
        this.environment = environment;
      }
    };
  }
});

// ../../packages/device-identity/dist/trusted-time.js
var MAX_REVOCATION_SNAPSHOT_AGE_HOURS;
var init_trusted_time = __esm({
  "../../packages/device-identity/dist/trusted-time.js"() {
    "use strict";
    init_errors2();
    MAX_REVOCATION_SNAPSHOT_AGE_HOURS = {
      development: 30 * 24,
      pilot: 14 * 24,
      production: 14 * 24
    };
  }
});

// ../../packages/device-identity/dist/dev-crypto.js
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { createHash as createHash3, randomUUID } from "node:crypto";
function publicKeyFingerprint(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return sha256Hex(new Uint8Array(der));
}
function verifyAgainst(publicKeyPem, payload, signature) {
  try {
    return verify(null, Buffer.from(payload), createPublicKey(publicKeyPem), Buffer.from(signature));
  } catch {
    return false;
  }
}
function verifyDetachedSignature(publicKeyPem, payload, signature) {
  return verifyAgainst(publicKeyPem, payload, signature);
}
var sha256Hex, PrivateKeyVault, vault;
var init_dev_crypto = __esm({
  "../../packages/device-identity/dist/dev-crypto.js"() {
    "use strict";
    init_environments();
    init_errors2();
    sha256Hex = (data) => createHash3("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex");
    PrivateKeyVault = class {
      #keys = /* @__PURE__ */ new Map();
      store(handle, privateKeyPem) {
        this.#keys.set(handle, privateKeyPem);
      }
      /** Signs WITHOUT surrendering the key. The only way the key is ever used. */
      signWith(handle, payload) {
        const pem = this.#keys.get(handle);
        if (pem === void 0) {
          throw new RequiredCryptographicValueError(`a key registered under handle ${handle}`, "development");
        }
        return new Uint8Array(sign(null, Buffer.from(payload), createPrivateKey(pem)));
      }
      has(handle) {
        return this.#keys.has(handle);
      }
      /**
       * Drops the private half. KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001.
       *
       * Returns whether a key was actually held, so a caller can tell "erased" from
       * "there was nothing here" — a distinction KLREQ-031 depends on, because
       * absence must never be reported as destruction.
       *
       * DEVELOPMENT ONLY, and software-backed: this removes a process-memory entry.
       * It is not hardware-backed erasure and proves nothing about a TPM or secure
       * element (BLK-005 §4 keeps that certification BLOCKED).
       */
      destroy(handle) {
        return this.#keys.delete(handle);
      }
    };
    vault = new PrivateKeyVault();
  }
});

// ../../packages/device-identity/dist/certificate-validity.js
var init_certificate_validity = __esm({
  "../../packages/device-identity/dist/certificate-validity.js"() {
    "use strict";
    init_trusted_time();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/certificate-renewal.js
var MS_PER_DAY;
var init_certificate_renewal = __esm({
  "../../packages/device-identity/dist/certificate-renewal.js"() {
    "use strict";
    init_certificate_validity();
    init_trusted_time();
    MS_PER_DAY = 1e3 * 60 * 60 * 24;
  }
});

// ../../packages/device-identity/dist/revocation-snapshot.js
var MS_PER_HOUR;
var init_revocation_snapshot = __esm({
  "../../packages/device-identity/dist/revocation-snapshot.js"() {
    "use strict";
    init_certificate_validity();
    init_trusted_time();
    MS_PER_HOUR = 1e3 * 60 * 60;
  }
});

// ../../packages/device-identity/dist/configuration-validity.js
var init_configuration_validity = __esm({
  "../../packages/device-identity/dist/configuration-validity.js"() {
    "use strict";
    init_certificate_validity();
    init_trusted_time();
  }
});

// ../../packages/device-identity/dist/certificate-issuance.js
var init_certificate_issuance = __esm({
  "../../packages/device-identity/dist/certificate-issuance.js"() {
    "use strict";
    init_errors2();
    init_trusted_time();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/operational-recovery-identity.js
var init_operational_recovery_identity = __esm({
  "../../packages/device-identity/dist/operational-recovery-identity.js"() {
    "use strict";
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/issuance-adapter.js
var init_issuance_adapter = __esm({
  "../../packages/device-identity/dist/issuance-adapter.js"() {
    "use strict";
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/replacement-key-pop.js
var init_replacement_key_pop = __esm({
  "../../packages/device-identity/dist/replacement-key-pop.js"() {
    "use strict";
    init_trusted_time();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/provisioning-pop.js
var init_provisioning_pop = __esm({
  "../../packages/device-identity/dist/provisioning-pop.js"() {
    "use strict";
    init_trusted_time();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/activation-ack.js
var init_activation_ack = __esm({
  "../../packages/device-identity/dist/activation-ack.js"() {
    "use strict";
    init_trusted_time();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/pairing.js
import { createHash as createHash4 } from "node:crypto";
function transcriptFields(t) {
  return [
    t.pairingSessionId,
    t.protocolVersion,
    t.purpose,
    t.tenantId,
    t.digitalStoreId,
    t.storeLocationId,
    t.environment,
    t.hubDeviceId,
    String(t.hubAssignmentGeneration),
    t.hubCertificateSerial,
    t.hubCertificateFingerprint,
    t.terminalDeviceId,
    String(t.terminalAssignmentGeneration),
    t.terminalProfileKey,
    t.terminalCertificateSerial,
    t.terminalCertificateFingerprint,
    t.terminalNonce,
    t.hubNonce,
    t.issuedAt.toISOString(),
    t.expiresAt.toISOString()
  ];
}
function pairingTranscriptBytes(t) {
  return Buffer.from([PAIRING_TRANSCRIPT_KIND, ...transcriptFields(t)].join("\n"), "utf8");
}
function pairingTranscriptHash(t) {
  return createHash4("sha256").update(Buffer.from(pairingTranscriptBytes(t))).digest("hex");
}
function terminalPairingProofBytes(t) {
  return Buffer.from([PAIRING_TERMINAL_PROOF_KIND, ...transcriptFields(t)].join("\n"), "utf8");
}
function hubPairingProofBytes(t) {
  return Buffer.from([PAIRING_HUB_PROOF_KIND, ...transcriptFields(t)].join("\n"), "utf8");
}
function pairingReceiptBytes(r) {
  return Buffer.from([
    PAIRING_RECEIPT_KIND,
    r.receiptId,
    r.receiptVersion,
    r.pairingSessionId,
    r.transcriptHash,
    r.hubDeviceId,
    r.hubCertificateFingerprint,
    r.terminalDeviceId,
    r.terminalCertificateFingerprint,
    r.tenantId,
    r.digitalStoreId,
    r.storeLocationId,
    r.environment,
    String(r.terminalAssignmentGeneration),
    r.terminalProfileKey,
    r.pairedAt.toISOString(),
    r.validUntil === null ? "-" : r.validUntil.toISOString(),
    r.correlationId
  ].join("\n"), "utf8");
}
function checkBindings(t, e, now) {
  const refuse = (refusalCode, detail) => ({
    verified: false,
    refusalCode,
    detail
  });
  if (t.protocolVersion !== PAIRING_PROTOCOL_VERSION || e.protocolVersion !== PAIRING_PROTOCOL_VERSION) {
    return refuse("PAIR_VERSION_INCOMPATIBLE", `protocol ${t.protocolVersion} is not ${PAIRING_PROTOCOL_VERSION}`);
  }
  if (t.purpose !== PAIRING_PURPOSE || e.purpose !== PAIRING_PURPOSE) {
    return refuse("PAIR_SESSION_MISMATCH", `the transcript purpose is ${t.purpose}`);
  }
  if (t.pairingSessionId !== e.pairingSessionId) {
    return refuse("PAIR_SESSION_MISMATCH", "the proof belongs to another pairing session");
  }
  if (t.tenantId !== e.tenantId || t.digitalStoreId !== e.digitalStoreId || t.storeLocationId !== e.storeLocationId) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", "the proof belongs to another Tenant, Store or Location");
  }
  if (t.environment !== e.environment) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", `the proof is for environment ${t.environment}`);
  }
  if (t.hubDeviceId !== e.hubDeviceId || t.hubAssignmentGeneration !== e.hubAssignmentGeneration || t.hubCertificateSerial !== e.hubCertificateSerial || t.hubCertificateFingerprint !== e.hubCertificateFingerprint) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", "the proof names a different Store Hub identity");
  }
  if (t.terminalDeviceId !== e.terminalDeviceId || t.terminalAssignmentGeneration !== e.terminalAssignmentGeneration || t.terminalCertificateSerial !== e.terminalCertificateSerial || t.terminalCertificateFingerprint !== e.terminalCertificateFingerprint) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", "the proof names a different terminal identity");
  }
  if (t.terminalProfileKey !== e.terminalProfileKey) {
    return refuse("PAIR_PROFILE_FORBIDDEN", "the proof names a profile the assignment does not grant");
  }
  if (t.terminalNonce !== e.terminalNonce || t.hubNonce !== e.hubNonce) {
    return refuse("PAIR_NONCE_MISMATCH", "a directional nonce is not the one this session bound");
  }
  if (now.getTime() < t.issuedAt.getTime()) {
    return refuse("PAIR_CHALLENGE_NOT_YET_VALID", "the session is dated in the future");
  }
  if (now.getTime() >= t.expiresAt.getTime()) {
    return refuse("PAIR_CHALLENGE_EXPIRED", "the pairing session expired");
  }
  return null;
}
function verifyTerminalPairingProof(transcript, signature, terminalPublicKeyPem, expectation, hubTime, computeFingerprint, verifySignature = verifyDetachedSignature) {
  const bound = checkBindings(transcript, expectation, hubTime);
  if (bound !== null)
    return bound;
  const actual = computeFingerprint(terminalPublicKeyPem);
  if (actual !== expectation.signerKeyFingerprint || transcript.terminalCertificateFingerprint !== expectation.signerKeyFingerprint) {
    return {
      verified: false,
      refusalCode: "PAIR_CERT_INVALID",
      detail: "the presented key is not the terminal's credentialed key"
    };
  }
  if (!verifySignature(terminalPublicKeyPem, terminalPairingProofBytes(transcript), signature)) {
    return {
      verified: false,
      refusalCode: "PAIR_CHALLENGE_FAILED",
      detail: "the terminal proof does not verify under the credentialed key"
    };
  }
  return { verified: true, transcriptHash: pairingTranscriptHash(transcript) };
}
var PAIRING_PROTOCOL_VERSION, PAIRING_PURPOSE, PAIRING_TERMINAL_PROOF_KIND, PAIRING_HUB_PROOF_KIND, PAIRING_RECEIPT_KIND, PAIRING_TRANSCRIPT_KIND;
var init_pairing = __esm({
  "../../packages/device-identity/dist/pairing.js"() {
    "use strict";
    init_dev_crypto();
    PAIRING_PROTOCOL_VERSION = "1.0";
    PAIRING_PURPOSE = "hub_terminal_pairing";
    PAIRING_TERMINAL_PROOF_KIND = "kitluy.pairing-terminal-proof.v1";
    PAIRING_HUB_PROOF_KIND = "kitluy.pairing-hub-proof.v1";
    PAIRING_RECEIPT_KIND = "kitluy.pairing-receipt.v1";
    PAIRING_TRANSCRIPT_KIND = "kitluy.pairing-transcript.v1";
  }
});

// ../../packages/device-identity/dist/same-key-renewal-preflight.js
var init_same_key_renewal_preflight = __esm({
  "../../packages/device-identity/dist/same-key-renewal-preflight.js"() {
    "use strict";
    init_certificate_validity();
    init_certificate_renewal();
    init_trusted_time();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/same-key-renewal-issuance.js
var init_same_key_renewal_issuance = __esm({
  "../../packages/device-identity/dist/same-key-renewal-issuance.js"() {
    "use strict";
    init_certificate_validity();
    init_trusted_time();
    init_dev_crypto();
    init_issuance_adapter();
    init_same_key_renewal_preflight();
  }
});

// ../../packages/device-identity/dist/replacement-key-provider.js
var init_replacement_key_provider = __esm({
  "../../packages/device-identity/dist/replacement-key-provider.js"() {
    "use strict";
    init_errors2();
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/rotate-key-renewal-issuance.js
var init_rotate_key_renewal_issuance = __esm({
  "../../packages/device-identity/dist/rotate-key-renewal-issuance.js"() {
    "use strict";
    init_certificate_validity();
    init_trusted_time();
    init_dev_crypto();
    init_issuance_adapter();
    init_replacement_key_pop();
    init_same_key_renewal_preflight();
    init_same_key_renewal_issuance();
    init_replacement_key_provider();
  }
});

// ../../packages/device-identity/dist/renewal-reconciliation.js
var init_renewal_reconciliation = __esm({
  "../../packages/device-identity/dist/renewal-reconciliation.js"() {
    "use strict";
    init_trusted_time();
  }
});

// ../../packages/device-identity/dist/credential-lifecycle.js
var init_credential_lifecycle = __esm({
  "../../packages/device-identity/dist/credential-lifecycle.js"() {
    "use strict";
    init_trusted_time();
  }
});

// ../../packages/device-identity/dist/credential-lifecycle-jobs.js
var DEVICE_JOB_MAX_ATTEMPTS;
var init_credential_lifecycle_jobs = __esm({
  "../../packages/device-identity/dist/credential-lifecycle-jobs.js"() {
    "use strict";
    init_credential_lifecycle();
    init_renewal_reconciliation();
    DEVICE_JOB_MAX_ATTEMPTS = 5;
  }
});

// ../../packages/device-identity/dist/credential-revocation.js
var COMPROMISE_REASONS, COMPROMISE_REASON_SET;
var init_credential_revocation = __esm({
  "../../packages/device-identity/dist/credential-revocation.js"() {
    "use strict";
    COMPROMISE_REASONS = [
      "KEY_COMPROMISE",
      "DEVICE_STOLEN",
      "PROVIDER_COMPROMISE",
      // DEVICE_LOST belongs here for the same reason DEVICE_STOLEN does. The
      // distinction between lost and stolen is about intent, not about custody:
      // either way a device holding a private key is somewhere the operator does
      // not control. Leaving it out allowed a lost device to be revoked with
      // NO_RECOVERY, which opens no case and schedules no replacement — the exact
      // outcome this list exists to prevent.
      "DEVICE_LOST"
    ];
    COMPROMISE_REASON_SET = new Set(COMPROMISE_REASONS);
  }
});

// ../../packages/device-identity/dist/pg-revocation-gateway.js
var init_pg_revocation_gateway = __esm({
  "../../packages/device-identity/dist/pg-revocation-gateway.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/pg-revocation-lookup.js
var init_pg_revocation_lookup = __esm({
  "../../packages/device-identity/dist/pg-revocation-lookup.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/key-destruction.js
var MAX_DESTRUCTION_EXECUTION_ATTEMPTS;
var init_key_destruction = __esm({
  "../../packages/device-identity/dist/key-destruction.js"() {
    "use strict";
    init_replacement_key_provider();
    MAX_DESTRUCTION_EXECUTION_ATTEMPTS = 5;
  }
});

// ../../packages/device-identity/dist/revocation-and-destruction-jobs.js
function completed(resultCode) {
  return { kind: "completed", resultCode };
}
function failed(failureCode) {
  return { kind: "failed", failureCode };
}
var DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS, DEVICE_REVOCATION_JOB_FAILURE_CODES, REVOCATION_OUTCOME_ROUTING, REVOCATION_OUTCOME_INDEX, REVOCATION_REFUSAL_ROUTING, REVOCATION_REFUSAL_INDEX, KEY_DESTRUCTION_OUTCOME_ROUTING, KEY_DESTRUCTION_OUTCOME_INDEX, RECOVERY_DISPOSITION_ROUTING, RECOVERY_DISPOSITION_INDEX, DESTRUCTION_REQUEST_STATUS_ROUTING, DESTRUCTION_REQUEST_STATUS_INDEX;
var init_revocation_and_destruction_jobs = __esm({
  "../../packages/device-identity/dist/revocation-and-destruction-jobs.js"() {
    "use strict";
    init_credential_lifecycle_jobs();
    init_environments();
    init_credential_revocation();
    init_key_destruction();
    DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS = Math.min(DEVICE_JOB_MAX_ATTEMPTS, MAX_DESTRUCTION_EXECUTION_ATTEMPTS);
    DEVICE_REVOCATION_JOB_FAILURE_CODES = {
      /** The payload carried no approval request id. Rule: a worker never approves. */
      APPROVAL_REFERENCE_ABSENT: "REVOCATION_APPROVAL_REFERENCE_ABSENT",
      /** The payload named no approver. Same rule, other half of the pair. */
      APPROVER_ABSENT: "REVOCATION_APPROVER_ABSENT",
      /** The payload named the WORKER as approver — a synthesised approval. */
      WORKER_SELF_APPROVED: "REVOCATION_WORKER_SELF_APPROVED",
      REVOCATION_REFUSED: "REVOCATION_REFUSED",
      REVOCATION_MANUAL_REVIEW: "REVOCATION_MANUAL_REVIEW_REQUIRED",
      RECOVERY_DOWNGRADED: "RECOVERY_DISPOSITION_DOWNGRADED",
      RECOVERY_MANUAL_REVIEW: "RECOVERY_MANUAL_SECURITY_REVIEW",
      RECOVERY_UNKNOWN_REASON: "RECOVERY_UNKNOWN_REVOCATION_REASON",
      RECOVERY_UNKNOWN_DISPOSITION: "RECOVERY_UNKNOWN_DISPOSITION",
      DESTRUCTION_REFUSED: "DESTRUCTION_REFUSED",
      DESTRUCTION_MANUAL_REVIEW: "DESTRUCTION_MANUAL_REVIEW_REQUIRED",
      /** The provider was asked and did not say. NOT a retry. See Rule 3 below. */
      DESTRUCTION_RECONCILIATION_REQUIRED: "DESTRUCTION_RECONCILIATION_REQUIRED",
      DESTRUCTION_ATTEMPTS_EXHAUSTED: "DESTRUCTION_ATTEMPTS_EXHAUSTED",
      DESTRUCTION_REQUEST_NOT_FOUND: "DESTRUCTION_REQUEST_NOT_FOUND",
      DESTRUCTION_UNKNOWN_REQUEST_STATE: "DESTRUCTION_UNKNOWN_REQUEST_STATE",
      PAYLOAD_INCOMPLETE: "DEVICE_JOB_PAYLOAD_INCOMPLETE",
      ENVIRONMENT_UNRECOGNISED: "DEVICE_JOB_ENVIRONMENT_UNRECOGNISED",
      /** The job named a different device from its subject. Runtime-classified. */
      SCOPE_MISMATCH: "AUTHORIZATION_FAILED"
    };
    REVOCATION_OUTCOME_ROUTING = {
      REVOKED: completed("REVOKED"),
      // Not "REVOKED, again". The credential was already repudiated, this attempt
      // added no second effect, and that is precisely what makes replaying a job
      // with the same dedupe key safe. Recorded as a replay, not a fresh success.
      ALREADY_REVOKED: completed("JOB_RESULT_REPLAYED"),
      REVOCATION_REFUSED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_REFUSED),
      // Group 0136 saying a DIFFERENT intent met an already-revoked credential.
      // Flattening it into a success is how a conflict becomes a green tick.
      MANUAL_REVIEW_REQUIRED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW)
    };
    REVOCATION_OUTCOME_INDEX = new Map(Object.entries(REVOCATION_OUTCOME_ROUTING));
    REVOCATION_REFUSAL_ROUTING = {
      REVOCATION_NO_REQUEST_ID: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
      REVOCATION_NO_REQUESTER: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
      REVOCATION_NO_SOURCE: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
      REVOCATION_NO_REASON: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
      REVOCATION_SELF_APPROVED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.WORKER_SELF_APPROVED),
      REVOCATION_RECOVERY_DOWNGRADED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_DOWNGRADED),
      // The only retryable one, and only because nothing was decided.
      REVOCATION_GATEWAY_FAILED: failed("DATABASE_UNAVAILABLE"),
      // NOT retryable. A privilege denial is permanent: retrying it burns the
      // attempt budget and then dead-letters an AUTHORIZATION failure as a database
      // outage, which sends whoever reads it looking at the wrong thing.
      REVOCATION_NOT_AUTHORIZED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW),
      REVOCATION_UNKNOWN_OUTCOME: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW)
    };
    REVOCATION_REFUSAL_INDEX = new Map(Object.entries(REVOCATION_REFUSAL_ROUTING));
    KEY_DESTRUCTION_OUTCOME_ROUTING = {
      DESTROYED: completed("DESTROYED"),
      // The provider had already erased it and said so with evidence. One key, one
      // erasure: this is a replay, and recording it as a fresh destruction would
      // make the attempt log claim two keys died.
      ALREADY_DESTROYED: completed("JOB_RESULT_REPLAYED"),
      ALREADY_CONFIRMED: completed("JOB_RESULT_REPLAYED"),
      DESTRUCTION_REFUSED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_REFUSED),
      // AMBIGUITY IS NOT A TRANSIENT FAULT. The provider was asked and did not say,
      // so nobody knows whether a private key still exists. A retry would call the
      // provider AGAIN on a request whose first call may have succeeded; this code
      // is absent from `RETRYABLE_FAILURE_CODES` on purpose, so the runtime routes
      // it to manual review, and the handler additionally proposes a reconcile job.
      RECONCILIATION_REQUIRED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      MANUAL_REVIEW_REQUIRED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_MANUAL_REVIEW)
    };
    KEY_DESTRUCTION_OUTCOME_INDEX = new Map(Object.entries(KEY_DESTRUCTION_OUTCOME_ROUTING));
    RECOVERY_DISPOSITION_ROUTING = {
      NO_RECOVERY: completed("NO_ACTION_REQUIRED"),
      RECOVERY_REQUIRED: completed("RECOVERY_REQUIRED"),
      REPROVISION_REQUIRED: completed("REPROVISION_REQUIRED"),
      REASSIGNMENT_REQUIRED: completed("REASSIGNMENT_REQUIRED"),
      MANUAL_SECURITY_REVIEW: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_MANUAL_REVIEW)
    };
    RECOVERY_DISPOSITION_INDEX = new Map(Object.entries(RECOVERY_DISPOSITION_ROUTING));
    DESTRUCTION_REQUEST_STATUS_ROUTING = {
      executed: completed("JOB_RESULT_REPLAYED"),
      requested: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      approved: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      pending_execution: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      failed: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      manual_review: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      cancelled: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
      expired: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED)
    };
    DESTRUCTION_REQUEST_STATUS_INDEX = new Map(Object.entries(DESTRUCTION_REQUEST_STATUS_ROUTING));
  }
});

// ../../packages/device-identity/dist/snapshot-signing.js
var init_snapshot_signing = __esm({
  "../../packages/device-identity/dist/snapshot-signing.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/release-manifest.js
var init_release_manifest = __esm({
  "../../packages/device-identity/dist/release-manifest.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/edge-discovery.js
function edgeDiscoveryRecordBytes(record) {
  return Buffer.from([
    EDGE_DISCOVERY_KIND,
    record.protocolVersion,
    record.recordId,
    record.hubDeviceId,
    record.hubCertificateFingerprint,
    record.tenantId,
    record.digitalStoreId,
    record.storeLocationId,
    record.environment,
    record.hostname,
    String(record.port),
    record.issuedAt.toISOString(),
    record.expiresAt.toISOString()
  ].join("\n"), "utf8");
}
var EDGE_DISCOVERY_KIND, EDGE_DISCOVERY_SERVICE_TYPE, EDGE_DISCOVERY_REFRESH_SECONDS, EDGE_DISCOVERY_VALIDITY_SECONDS, EDGE_LAN_PORT;
var init_edge_discovery = __esm({
  "../../packages/device-identity/dist/edge-discovery.js"() {
    "use strict";
    init_dev_crypto();
    EDGE_DISCOVERY_KIND = "kitluy.edge-discovery.v1";
    EDGE_DISCOVERY_SERVICE_TYPE = "_kitluy-edge._tcp.local";
    EDGE_DISCOVERY_REFRESH_SECONDS = 30;
    EDGE_DISCOVERY_VALIDITY_SECONDS = 90;
    EDGE_LAN_PORT = 7443;
  }
});

// ../../packages/device-identity/dist/enrollment-time-token.js
var init_enrollment_time_token = __esm({
  "../../packages/device-identity/dist/enrollment-time-token.js"() {
    "use strict";
    init_snapshot_signing();
  }
});

// ../../packages/device-identity/dist/manufacturing-enrollment-pop.js
var init_manufacturing_enrollment_pop = __esm({
  "../../packages/device-identity/dist/manufacturing-enrollment-pop.js"() {
    "use strict";
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/hub-claim-payload.js
var init_hub_claim_payload = __esm({
  "../../packages/device-identity/dist/hub-claim-payload.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/terminal-configuration-delivery.js
function terminalConfigurationDeliveryBytes(d) {
  return Buffer.from([
    TERMINAL_CONFIGURATION_DELIVERY_KIND,
    d.snapshotId,
    String(d.configurationVersion),
    String(d.schemaVersion),
    d.tenantId,
    d.digitalStoreId,
    d.storeLocationId,
    d.environment,
    d.hubDeviceId,
    d.terminalDeviceId,
    String(d.assignmentGeneration),
    d.terminalProfileCode,
    d.primaryVertical,
    d.minimumApplicationVersion,
    d.maximumApplicationVersion === null ? "-" : d.maximumApplicationVersion,
    d.issuedAt.toISOString(),
    d.effectiveAt.toISOString(),
    d.validUntil.toISOString(),
    d.manifestSha256,
    d.payloadSha256,
    d.signingKeyId,
    d.correlationId
  ].join("\n"), "utf8");
}
var TERMINAL_CONFIGURATION_DELIVERY_KIND;
var init_terminal_configuration_delivery = __esm({
  "../../packages/device-identity/dist/terminal-configuration-delivery.js"() {
    "use strict";
    init_dev_crypto();
    TERMINAL_CONFIGURATION_DELIVERY_KIND = "kitluy.terminal-configuration-delivery.v2";
  }
});

// ../../packages/device-identity/dist/credential-package.js
var init_credential_package = __esm({
  "../../packages/device-identity/dist/credential-package.js"() {
    "use strict";
    init_dev_crypto();
    init_certificate_validity();
  }
});

// ../../packages/device-identity/dist/device-registration-request.js
var init_device_registration_request = __esm({
  "../../packages/device-identity/dist/device-registration-request.js"() {
    "use strict";
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/device-runtime-report.js
var init_device_runtime_report = __esm({
  "../../packages/device-identity/dist/device-runtime-report.js"() {
    "use strict";
    init_dev_crypto();
  }
});

// ../../packages/device-identity/dist/index.js
var init_dist = __esm({
  "../../packages/device-identity/dist/index.js"() {
    "use strict";
    init_environments();
    init_errors2();
    init_errors2();
    init_trusted_time();
    init_certificate_validity();
    init_certificate_renewal();
    init_revocation_snapshot();
    init_configuration_validity();
    init_dev_crypto();
    init_certificate_issuance();
    init_operational_recovery_identity();
    init_issuance_adapter();
    init_replacement_key_pop();
    init_provisioning_pop();
    init_activation_ack();
    init_pairing();
    init_same_key_renewal_preflight();
    init_same_key_renewal_issuance();
    init_replacement_key_provider();
    init_rotate_key_renewal_issuance();
    init_renewal_reconciliation();
    init_credential_lifecycle();
    init_credential_lifecycle_jobs();
    init_credential_revocation();
    init_pg_revocation_gateway();
    init_pg_revocation_lookup();
    init_key_destruction();
    init_revocation_and_destruction_jobs();
    init_snapshot_signing();
    init_release_manifest();
    init_edge_discovery();
    init_enrollment_time_token();
    init_manufacturing_enrollment_pop();
    init_hub_claim_payload();
    init_terminal_configuration_delivery();
    init_credential_package();
    init_device_registration_request();
    init_device_runtime_report();
  }
});

// ../../packages/shared-types/dist/index.js
function verticalKeyFromCloudCode(value) {
  return VERTICAL_KEY_BY_CLOUD_CODE.get(value) ?? null;
}
function isVerticalKey(value) {
  return VERTICAL_KEY_SET.has(value);
}
var asId, KITLUY_ENVIRONMENTS, VERTICAL_PHASES, VERTICAL_CLOUD_CODES, VERTICAL_CLOUD_CODE_COVERS_REGISTRY, VERTICAL_KEY_BY_CLOUD_CODE, VERTICAL_KEY_SET;
var init_dist2 = __esm({
  "../../packages/shared-types/dist/index.js"() {
    "use strict";
    asId = {
      tenantId: (v) => v,
      partnerAccountId: (v) => v,
      digitalStoreId: (v) => v,
      storeLocationId: (v) => v,
      chainId: (v) => v,
      userId: (v) => v,
      deviceId: (v) => v,
      hubId: (v) => v,
      transactionId: (v) => v,
      correlationId: (v) => v,
      idempotencyKey: (v) => v
    };
    KITLUY_ENVIRONMENTS = [
      "local",
      "development",
      "staging",
      "pilot",
      "production",
      "disaster_recovery"
    ];
    VERTICAL_PHASES = [
      { phase: 1, key: "laundry", name: "Laundry Stores and Shops" },
      { phase: 2, key: "cafe_restaurant", name: "Caf\xE9 and Restaurant Stores" },
      { phase: 3, key: "ecommerce", name: "Online Retailers and eCommerce Businesses" },
      { phase: 4, key: "convenience", name: "Convenience Stores" },
      { phase: 5, key: "pharmacy", name: "Drugstores and Pharmacies" },
      { phase: 6, key: "department_store", name: "Department Stores" },
      { phase: 7, key: "grocery", name: "Grocery Stores" },
      { phase: 8, key: "supermarket", name: "Supermarkets" }
    ];
    VERTICAL_CLOUD_CODES = {
      laundry: "LAUNDRY",
      cafe_restaurant: "CAFE_RESTAURANT",
      ecommerce: "ECOMMERCE",
      convenience: "CONVENIENCE",
      pharmacy: "PHARMACY",
      department_store: "DEPARTMENT_STORE",
      grocery: "GROCERY",
      supermarket: "SUPERMARKET"
    };
    VERTICAL_CLOUD_CODE_COVERS_REGISTRY = VERTICAL_PHASES.every((phase) => phase.key in VERTICAL_CLOUD_CODES) && Object.keys(VERTICAL_CLOUD_CODES).length === VERTICAL_PHASES.length;
    VERTICAL_KEY_BY_CLOUD_CODE = new Map(Object.entries(VERTICAL_CLOUD_CODES).map(([key, code]) => [code, key]));
    VERTICAL_KEY_SET = new Set(VERTICAL_PHASES.map((v) => v.key));
  }
});

// src/hub/edge/runtime-bootstrap.ts
import { createHash as createHash6, randomUUID as randomUUID5, scryptSync, timingSafeEqual } from "node:crypto";
async function readAuthorityTime(pool) {
  const instant2 = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query(`select now() as now`);
      const row = result.rows[0];
      if (row === void 0) throw new Error("the Hub database returned no transaction time");
      return row.now;
    },
    HUB_RUNTIME_ROLE
  );
  const iso = instant2.toISOString();
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    authorityTime: iso,
    authoritySource: "hub_database",
    responseId: randomUUID5(),
    generatedAt: iso,
    maxCacheAgeSeconds: AUTHORITY_TIME_MAX_CACHE_AGE_SECONDS
  };
}
async function readRuntimeEligibility(pool, terminalDeviceId, certificateSerial, environment) {
  return withHubTransaction(
    pool,
    async (client) => deriveEligibility(client, terminalDeviceId, certificateSerial, environment),
    HUB_RUNTIME_ROLE
  );
}
async function selectOperationalHubIdentity(client) {
  const operational = await client.query(
    `select id
       from edge_identity.hub_device
      where device_kind = 'store_hub'
        and trust_status = 'trusted'
        and lifecycle_status = 'deployed'
      order by created_at
      limit 1`
  );
  const row = operational.rows[0];
  if (row !== void 0) {
    return { kind: "operational", id: row.id };
  }
  const newest = await client.query(
    `select lifecycle_status
       from edge_identity.hub_device
      where device_kind = 'store_hub'
      order by created_at desc
      limit 1`
  );
  const current = newest.rows[0];
  if (current === void 0) {
    return {
      kind: "refused",
      refusal: "HUB_NOT_OPERATIONAL",
      detail: "no Store Hub device record exists"
    };
  }
  if (current.lifecycle_status === "retired") {
    return { kind: "refused", refusal: "HUB_RETIRED", detail: "this Store Hub is retired" };
  }
  return {
    kind: "refused",
    refusal: "HUB_NOT_OPERATIONAL",
    detail: "this Store Hub has no trusted, deployed identity"
  };
}
async function readContainmentDirective(client, terminalDeviceId) {
  const containment = await client.query(
    `select directive from edge_identity.effective_containment where device_uuid = $1::uuid`,
    [terminalDeviceId]
  );
  return containment.rows[0]?.directive ?? "none";
}
function isBlockingContainment(directive) {
  return directive === "operations_restricted" || directive === "suspended" || directive === "quarantined";
}
async function readBlockingContainment(client, terminalDeviceId) {
  const directive = await readContainmentDirective(client, terminalDeviceId);
  return isBlockingContainment(directive) ? directive : null;
}
async function readCurrentProfileGrants(client, terminalDeviceId) {
  const grants = await client.query(
    `select tpa.id, tpa.profile_code
       from edge_config.terminal_profile_assignment tpa
       join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
      where tpa.terminal_device_id = $1::uuid
        and tpa.enabled
        and tpa.effective_from <= now()
        and (tpa.effective_until is null or tpa.effective_until > now())
        and cs.state = 'active'
        and tpa.assignment_version = (
          select max(x.assignment_version)
            from edge_config.terminal_profile_assignment x
            join edge_config.configuration_snapshot xs on xs.id = x.source_snapshot_id
           where x.terminal_device_id = tpa.terminal_device_id
             and x.enabled
             and x.effective_from <= now()
             and (x.effective_until is null or x.effective_until > now())
             and xs.state = 'active')
      order by tpa.profile_code`,
    [terminalDeviceId]
  );
  return grants.rows;
}
async function terminalHoldsCurrentT1Grant(client, terminalDeviceId) {
  const grants = await readCurrentProfileGrants(client, terminalDeviceId);
  return grants.some((grant) => grant.profile_code === T1_PROFILE_CODE);
}
async function deriveEligibility(client, terminalDeviceId, certificateSerial, environment) {
  const refuse = (refusal2, detail) => ({
    outcome: "refused",
    refusal: refusal2,
    detail
  });
  const identity = await selectOperationalHubIdentity(client);
  if (identity.kind === "refused") {
    return refuse(identity.refusal, identity.detail);
  }
  const hubRow = { id: identity.id };
  const replacement = await client.query(
    `select mode from edge_identity.hub_replacement_state where singleton = true`
  );
  const mode = replacement.rows[0]?.mode ?? "normal";
  if (mode !== "normal") {
    return mode === "retired_rejected" ? refuse("HUB_RETIRED", "this Store Hub is locally retired") : refuse("HUB_REPLACEMENT_BLOCKED", `hub replacement state is ${mode}`);
  }
  const hubAssignment = await client.query(
    `select hub_device_id, tenant_id, digital_store_id, location_id, assignment_generation,
            primary_vertical_code
       from edge_identity.hub_assignment
      where hub_device_id = $1 and ended_at is null
      order by assignment_generation desc
      limit 1`,
    [hubRow.id]
  );
  const scope = hubAssignment.rows[0];
  if (scope === void 0) {
    return refuse("HUB_ASSIGNMENT_MISSING", "this Store Hub has no active assignment");
  }
  const primaryVertical = scope.primary_vertical_code?.trim() ?? "";
  if (primaryVertical.length === 0) {
    return refuse(
      "VERTICAL_UNAVAILABLE",
      "this Store Hub's assignment carries no primary vertical; nothing can be signed for the terminal"
    );
  }
  if (!isVerticalKey(primaryVertical)) {
    return refuse(
      "VERTICAL_UNAVAILABLE",
      `this Store Hub's assignment names '${primaryVertical}', which is not a registered vertical`
    );
  }
  const terminal = await client.query(
    `select tenant_id, digital_store_id, location_id, assignment_generation, lifecycle_status,
            last_client_sequence::text as last_client_sequence
       from edge_identity.terminal_device
      where id = $1::uuid`,
    [terminalDeviceId]
  );
  const terminalRow = terminal.rows[0];
  if (terminalRow === void 0) {
    return refuse("CREDENTIAL_NOT_CURRENT", "the terminal projection is missing");
  }
  if (terminalRow.tenant_id !== scope.tenant_id || terminalRow.digital_store_id !== scope.digital_store_id || terminalRow.location_id !== scope.location_id) {
    return refuse(
      "ASSIGNMENT_SCOPE_MISMATCH",
      "the terminal belongs to another Tenant, Store or Location"
    );
  }
  const credential = await client.query(
    `select id, rotation_generation, status
       from edge_identity.device_credential
      where certificate_serial = $1`,
    [certificateSerial]
  );
  const credentialRow = credential.rows[0];
  if (credentialRow === void 0 || credentialRow.status !== "active") {
    return refuse("CREDENTIAL_NOT_CURRENT", "the presented credential is not current");
  }
  const receipt = await client.query(
    `select terminal_assignment_generation, terminal_profile_code, paired_at
       from edge_identity.pairing_receipt
      where terminal_device_id = $1::uuid
      order by terminal_assignment_generation desc, paired_at desc
      limit 1`,
    [terminalDeviceId]
  );
  const receiptRow = receipt.rows[0];
  if (receiptRow === void 0) {
    return refuse("PAIRING_REQUIRED", "no pairing receipt exists for this terminal");
  }
  if (receiptRow.terminal_assignment_generation > terminalRow.assignment_generation) {
    return refuse(
      "ASSIGNMENT_GENERATION_STALE",
      "the terminal's assignment generation is behind one it has already paired at on this Hub"
    );
  }
  if (receiptRow.terminal_assignment_generation < terminalRow.assignment_generation) {
    const blocking = await readBlockingContainment(client, terminalDeviceId);
    if (blocking !== null) {
      return refuse("CONTAINMENT_PROHIBITS", `containment directive ${blocking} is in effect`);
    }
    return refuse(
      "PAIRING_REQUIRED",
      "the pairing receipt binds an earlier assignment generation; pair again at the current one"
    );
  }
  const grants = await readCurrentProfileGrants(client, terminalDeviceId);
  if (grants.length === 0) {
    return refuse("PROFILE_NOT_GRANTED", "no enabled profile assignment exists");
  }
  const grantRow = grants.find((grant) => grant.profile_code === T1_PROFILE_CODE);
  if (grantRow === void 0) {
    return refuse(
      "PROFILE_NOT_T1",
      `the assigned profiles are ${grants.map((grant) => grant.profile_code).join(", ")}`
    );
  }
  if (!grants.some((grant) => grant.profile_code === receiptRow.terminal_profile_code)) {
    return refuse(
      "ASSIGNMENT_GENERATION_STALE",
      "the pairing receipt binds a profile outside the terminal's current grants"
    );
  }
  const directive = await readContainmentDirective(client, terminalDeviceId);
  if (isBlockingContainment(directive)) {
    return refuse("CONTAINMENT_PROHIBITS", `containment directive ${directive} is in effect`);
  }
  const containmentState = directive === "cleared" ? "none" : directive;
  const snapshot = await client.query(
    `select snapshot_version
       from edge_config.configuration_snapshot
      where location_id = $1::uuid and state = 'active'`,
    [terminalRow.location_id]
  );
  const requiredVersion = snapshot.rows[0]?.snapshot_version;
  const nowRow = await client.query(`select now() as now`);
  const authorityTime = nowRow.rows[0]?.now ?? /* @__PURE__ */ new Date(0);
  return {
    outcome: "eligible",
    payload: {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      tenantId: terminalRow.tenant_id,
      digitalStoreId: terminalRow.digital_store_id,
      storeLocationId: terminalRow.location_id,
      environment,
      hubDeviceId: hubRow.id,
      terminalDeviceId,
      assignmentId: grantRow.id,
      assignmentGeneration: terminalRow.assignment_generation,
      terminalProfileCode: grantRow.profile_code,
      primaryVertical,
      credentialId: credentialRow.id,
      credentialGeneration: credentialRow.rotation_generation,
      credentialEligibility: "eligible",
      activationEligibility: "activated",
      pairingEligibility: "paired",
      pairedAt: receiptRow.paired_at.toISOString(),
      containmentState,
      hubReplacementState: mode,
      requiredConfigurationVersion: requiredVersion === void 0 ? null : Number(requiredVersion),
      nextClientSequence: (BigInt(terminalRow.last_client_sequence) + 1n).toString(),
      authorityTime: authorityTime.toISOString()
    }
  };
}
async function readCurrentConfigurationDelivery(pool, terminalDeviceId, certificateSerial, environment, signer, correlationId) {
  return withHubTransaction(
    pool,
    async (client) => {
      const eligibility = await deriveEligibility(
        client,
        terminalDeviceId,
        certificateSerial,
        environment
      );
      if (eligibility.outcome === "refused") {
        return {
          outcome: "refused",
          refusal: eligibility.refusal,
          detail: eligibility.detail
        };
      }
      const scope = eligibility.payload;
      const snapshot = await client.query(
        `select id, snapshot_version, schema_version, created_at, not_before,
                expires_at, manifest_sha256, signing_key_id
           from edge_config.configuration_snapshot
          where location_id = $1::uuid and state = 'active'`,
        [scope.storeLocationId]
      );
      const snapshotRow = snapshot.rows[0];
      if (snapshotRow === void 0) {
        return {
          outcome: "refused",
          refusal: "CONFIGURATION_MISSING",
          detail: "no active configuration snapshot exists for this Location"
        };
      }
      const sections = await client.query(
        `select section_code, content_json
           from edge_config.configuration_section
          where snapshot_id = $1::uuid
          order by section_code asc`,
        [snapshotRow.id]
      );
      const payload = {};
      for (const row of sections.rows) payload[row.section_code] = row.content_json;
      const payloadJson = canonicalJson(payload);
      const payloadSha256 = createHash6("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex");
      const profilesSection = payload["terminal_profiles"];
      const compatibility = profilesSection?.application_compatibility;
      const minimumApplicationVersion = typeof compatibility?.["minimum_application_version"] === "string" ? compatibility["minimum_application_version"] : "0.0.0";
      const maximumApplicationVersion = typeof compatibility?.["maximum_application_version"] === "string" ? compatibility["maximum_application_version"] : null;
      const nowRow = await client.query(`select now() as now`);
      const now = nowRow.rows[0] ?? { now: /* @__PURE__ */ new Date(0) };
      const validUntil = snapshotRow.expires_at ?? new Date(now.now.getTime() + DEV_DELIVERY_VALIDITY_HOURS * 36e5);
      const rollback = await client.query(
        `select snapshot_version
           from edge_config.configuration_snapshot
          where location_id = $1::uuid and state = 'staged'
          order by snapshot_version desc
          limit 1`,
        [scope.storeLocationId]
      );
      const rollbackRow = rollback.rows[0];
      const delivery = {
        snapshotId: snapshotRow.id,
        configurationVersion: Number(snapshotRow.snapshot_version),
        schemaVersion: snapshotRow.schema_version,
        tenantId: scope.tenantId,
        digitalStoreId: scope.digitalStoreId,
        storeLocationId: scope.storeLocationId,
        environment,
        hubDeviceId: scope.hubDeviceId,
        terminalDeviceId,
        assignmentGeneration: scope.assignmentGeneration,
        terminalProfileCode: scope.terminalProfileCode,
        primaryVertical: scope.primaryVertical,
        minimumApplicationVersion,
        maximumApplicationVersion,
        issuedAt: snapshotRow.created_at,
        effectiveAt: snapshotRow.not_before,
        validUntil,
        manifestSha256: snapshotRow.manifest_sha256,
        payloadSha256,
        signingKeyId: snapshotRow.signing_key_id,
        correlationId
      };
      const deliverySignature = Buffer.from(
        signer.sign(terminalConfigurationDeliveryBytes(delivery))
      ).toString("base64url");
      return {
        outcome: "delivery",
        body: {
          delivery: {
            ...delivery,
            issuedAt: delivery.issuedAt.toISOString(),
            effectiveAt: delivery.effectiveAt.toISOString(),
            validUntil: delivery.validUntil.toISOString()
          },
          payloadJson,
          deliverySignature,
          deliverySignerCertificateSerial: signer.certificateSerial,
          deliverySignerPublicKeyFingerprint: publicKeyFingerprint(signer.publicKeyPem),
          rollbackReference: rollbackRow === void 0 ? null : Number(rollbackRow.snapshot_version)
        }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
function staffCredentialVerifier(actorId, passcode) {
  return scryptSync(passcode, `kitluy.staff.${actorId}`, 32, { N: 16384, r: 8, p: 1 });
}
function verifyStaffCredential(actorId, passcode, storedVerifier) {
  if (storedVerifier.length !== 32) return false;
  const presented = staffCredentialVerifier(actorId, passcode);
  return timingSafeEqual(presented, storedVerifier);
}
async function resolveGrant(client, scope, actorId, permissionKey) {
  const result = await client.query(
    `select edge_config.resolve_permission_grant(
              $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
              'store_location', $3::uuid, true, now()) as verdict`,
    [scope.tenantId, scope.digitalStoreId, scope.locationId, actorId, permissionKey]
  );
  return result.rows[0]?.verdict ?? "unknown";
}
async function effectivePermissions(client, scope, actorId) {
  const keys = [
    PERMISSION_STAFF_SESSIONS_OPEN,
    PERMISSION_STAFF_SESSIONS_READ,
    PERMISSION_STAFF_SESSIONS_REFRESH,
    PERMISSION_STAFF_SESSIONS_CLOSE,
    PERMISSION_POS_T1_USE,
    PERMISSION_CUSTOMERS_READ,
    PERMISSION_CUSTOMERS_CREATE,
    PERMISSION_CONSENT_RECORD,
    PERMISSION_BOOKINGS_READ,
    PERMISSION_BOOKINGS_CREATE
  ];
  const held = [];
  for (const key of keys) {
    if (await resolveGrant(client, scope, actorId, key) === "allow") held.push(key);
  }
  return held;
}
function staffScope(row) {
  return {
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    locationId: row.location_id
  };
}
function sessionScope(row) {
  return {
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    locationId: row.location_id
  };
}
async function openStaffSession(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const refuse = (refusal2, detail) => ({
        outcome: "refused",
        refusal: refusal2,
        detail
      });
      const terminal = await client.query(
        `select id, tenant_id, digital_store_id, location_id, assignment_generation, lifecycle_status
           from edge_identity.terminal_device where id = $1::uuid`,
        [input.terminalDeviceId]
      );
      const terminalRow = terminal.rows[0];
      if (terminalRow === void 0) return refuse("SESSION_UNKNOWN", "unknown terminal");
      const staff = await client.query(
        `select actor_id, tenant_id, digital_store_id, location_id, display_name,
                credential_verifier, profile_codes, offline_valid_until, disabled
           from edge_identity.staff_cache where actor_id = $1::uuid`,
        [input.actorId]
      );
      const staffRow = staff.rows[0];
      if (staffRow === void 0) return refuse("STAFF_UNKNOWN", "no such staff member");
      if (staffRow.disabled) return refuse("STAFF_DISABLED", "the staff member is disabled");
      if (staffRow.tenant_id !== terminalRow.tenant_id || staffRow.digital_store_id !== terminalRow.digital_store_id || staffRow.location_id !== terminalRow.location_id) {
        return refuse("STAFF_SCOPE_MISMATCH", "the staff member belongs to another Store");
      }
      if (!verifyStaffCredential(input.actorId, input.passcode, staffRow.credential_verifier)) {
        return refuse("STAFF_CREDENTIAL_INVALID", "the presented credential does not verify");
      }
      if (!staffRow.profile_codes.includes(input.profileCode)) {
        return refuse(
          "STAFF_PROFILE_NOT_AUTHORIZED",
          "the staff member is not authorized for this profile"
        );
      }
      if (await resolveGrant(
        client,
        staffScope(staffRow),
        input.actorId,
        PERMISSION_STAFF_SESSIONS_OPEN
      ) !== "allow") {
        return refuse(
          "SESSION_PERMISSION_DENIED",
          `${PERMISSION_STAFF_SESSIONS_OPEN} is not granted`
        );
      }
      const nowRow = await client.query(`select now() as now`);
      const now = nowRow.rows[0]?.now ?? /* @__PURE__ */ new Date(0);
      if (now.getTime() >= staffRow.offline_valid_until.getTime()) {
        return refuse("STAFF_DISABLED", "the staff cache entry is beyond its governed validity");
      }
      const existing = await client.query(
        `select id, actor_id, opened_at, expires_at, session_generation
           from edge_identity.terminal_session
          where terminal_device_id = $1::uuid and profile_code = $2 and closed_at is null`,
        [input.terminalDeviceId, input.profileCode]
      );
      const open = existing.rows[0];
      if (open !== void 0) {
        if (open.expires_at.getTime() <= now.getTime()) {
          await client.query(
            `update edge_identity.terminal_session set closed_at = now(), status = 'expired' where id = $1::uuid`,
            [open.id]
          );
        } else if (open.actor_id === input.actorId) {
          const held2 = await effectivePermissions(client, staffScope(staffRow), input.actorId);
          return {
            outcome: "ok",
            result: "SESSION_ALREADY_OPEN",
            session: {
              sessionId: open.id,
              actorId: input.actorId,
              displayName: staffRow.display_name,
              profileCode: input.profileCode,
              openedAt: open.opened_at.toISOString(),
              expiresAt: open.expires_at.toISOString(),
              sessionGeneration: open.session_generation,
              effectivePermissions: held2,
              authorityTime: now.toISOString()
            }
          };
        } else {
          return refuse("SESSION_OCCUPIED", "another staff member's session is open");
        }
      }
      const lifetimeMs = DEV_STAFF_SESSION_LIFETIME_MINUTES * 6e4;
      const expiresAt = new Date(
        Math.min(now.getTime() + lifetimeMs, staffRow.offline_valid_until.getTime())
      );
      const sessionId = randomUUID5();
      const generation = (open?.session_generation ?? 0) + 1;
      await client.query(
        `insert into edge_identity.terminal_session
           (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
            profile_code, opened_at, expires_at, closed_at, session_generation,
            last_event_sequence, status)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
                 $7, $8, $9, null, $10, 0, 'open')`,
        [
          sessionId,
          staffRow.tenant_id,
          staffRow.digital_store_id,
          staffRow.location_id,
          input.terminalDeviceId,
          input.actorId,
          input.profileCode,
          now,
          expiresAt,
          generation
        ]
      );
      const held = await effectivePermissions(client, staffScope(staffRow), input.actorId);
      return {
        outcome: "ok",
        result: "SESSION_OPENED",
        session: {
          sessionId,
          actorId: input.actorId,
          displayName: staffRow.display_name,
          profileCode: input.profileCode,
          openedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          sessionGeneration: generation,
          effectivePermissions: held,
          authorityTime: now.toISOString()
        }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
async function loadOwnedOpenSession(client, sessionId, terminalDeviceId) {
  const result = await client.query(
    `select id, actor_id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
            opened_at, expires_at, closed_at, session_generation, credential_kind
       from edge_identity.terminal_session where id = $1::uuid`,
    [sessionId]
  );
  const row = result.rows[0];
  if (row === void 0)
    return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no such session" };
  if (row.terminal_device_id !== terminalDeviceId) {
    return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no such session" };
  }
  if (row.closed_at !== null) {
    return { ok: false, refusal: "SESSION_CLOSED", detail: "the session is closed" };
  }
  return { ok: true, row };
}
async function authorizeT1IntakeSession(client, input) {
  const owned = await loadOwnedOpenSession(client, input.sessionId, input.terminalDeviceId);
  if (!owned.ok) return { ok: false, refusal: owned.refusal, detail: owned.detail };
  const row = owned.row;
  const nowRow = await client.query(`select now() as now`);
  const now = nowRow.rows[0];
  if (now === void 0) {
    return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no transaction time" };
  }
  if (row.expires_at.getTime() <= now.now.getTime()) {
    return { ok: false, refusal: "SESSION_EXPIRED", detail: "the session already expired" };
  }
  if (row.profile_code !== T1_PROFILE_CODE) {
    return { ok: false, refusal: "T1_NOT_AUTHORIZED", detail: "the session is not a T1 session" };
  }
  const scope = sessionScope(row);
  if (row.credential_kind === "terminal_pin") {
    if (row.actor_id !== input.terminalDeviceId) {
      return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no such session" };
    }
    if (!await terminalHoldsCurrentT1Grant(client, input.terminalDeviceId)) {
      return {
        ok: false,
        refusal: "T1_NOT_AUTHORIZED",
        detail: "the terminal no longer holds a current T1 profile grant"
      };
    }
    if (await readBlockingContainment(client, input.terminalDeviceId) !== null) {
      return {
        ok: false,
        refusal: "T1_NOT_AUTHORIZED",
        detail: "a containment directive is in effect"
      };
    }
    if (!T1_TERMINAL_PIN_PERMISSIONS.includes(input.routePermission)) {
      return {
        ok: false,
        refusal: "SESSION_PERMISSION_DENIED",
        detail: `${input.routePermission} is not part of the T1 terminal surface`
      };
    }
    return {
      ok: true,
      authority: {
        sessionId: row.id,
        actorId: row.actor_id,
        tenantId: row.tenant_id,
        digitalStoreId: row.digital_store_id,
        locationId: row.location_id,
        profileCode: row.profile_code
      }
    };
  }
  if (await resolveGrant(client, scope, row.actor_id, PERMISSION_POS_T1_USE) !== "allow") {
    return {
      ok: false,
      refusal: "T1_NOT_AUTHORIZED",
      detail: `${PERMISSION_POS_T1_USE} is not granted`
    };
  }
  if (await resolveGrant(client, scope, row.actor_id, input.routePermission) !== "allow") {
    return {
      ok: false,
      refusal: "SESSION_PERMISSION_DENIED",
      detail: `${input.routePermission} is not granted`
    };
  }
  return {
    ok: true,
    authority: {
      sessionId: row.id,
      actorId: row.actor_id,
      tenantId: row.tenant_id,
      digitalStoreId: row.digital_store_id,
      locationId: row.location_id,
      profileCode: row.profile_code
    }
  };
}
async function refreshStaffSession(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const refuse = (refusal2, detail) => ({
        outcome: "refused",
        refusal: refusal2,
        detail
      });
      const owned = await loadOwnedOpenSession(client, input.sessionId, input.terminalDeviceId);
      if (!owned.ok) return refuse(owned.refusal, owned.detail);
      const row = owned.row;
      if (row.credential_kind !== "staff") {
        return refuse("SESSION_UNKNOWN", "no such staff session");
      }
      const nowRow = await client.query(`select now() as now`);
      const now = nowRow.rows[0]?.now ?? /* @__PURE__ */ new Date(0);
      if (row.expires_at.getTime() <= now.getTime()) {
        await client.query(
          `update edge_identity.terminal_session set closed_at = now(), status = 'expired' where id = $1::uuid`,
          [row.id]
        );
        return refuse("SESSION_EXPIRED", "the session already expired");
      }
      if (await resolveGrant(
        client,
        sessionScope(row),
        row.actor_id,
        PERMISSION_STAFF_SESSIONS_REFRESH
      ) !== "allow") {
        return refuse(
          "SESSION_PERMISSION_DENIED",
          `${PERMISSION_STAFF_SESSIONS_REFRESH} is not granted`
        );
      }
      const staff = await client.query(
        `select actor_id, tenant_id, digital_store_id, location_id, display_name,
                credential_verifier, profile_codes, offline_valid_until, disabled
           from edge_identity.staff_cache where actor_id = $1::uuid`,
        [row.actor_id]
      );
      const staffRow = staff.rows[0];
      if (staffRow === void 0 || staffRow.disabled) {
        return refuse("STAFF_DISABLED", "the staff member is no longer eligible");
      }
      const lifetimeMs = DEV_STAFF_SESSION_LIFETIME_MINUTES * 6e4;
      const expiresAt = new Date(
        Math.min(now.getTime() + lifetimeMs, staffRow.offline_valid_until.getTime())
      );
      if (expiresAt.getTime() <= now.getTime()) {
        return refuse("STAFF_DISABLED", "the staff cache entry is beyond its governed validity");
      }
      await client.query(
        `update edge_identity.terminal_session set expires_at = $2 where id = $1::uuid`,
        [row.id, expiresAt]
      );
      const held = await effectivePermissions(client, sessionScope(row), row.actor_id);
      return {
        outcome: "ok",
        result: "SESSION_REFRESHED",
        session: {
          sessionId: row.id,
          actorId: row.actor_id,
          displayName: staffRow.display_name,
          profileCode: row.profile_code,
          openedAt: row.opened_at.toISOString(),
          expiresAt: expiresAt.toISOString(),
          sessionGeneration: row.session_generation,
          effectivePermissions: held,
          authorityTime: now.toISOString()
        }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
async function closeStaffSession(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const refuse = (refusal2, detail) => ({
        outcome: "refused",
        refusal: refusal2,
        detail
      });
      const owned = await loadOwnedOpenSession(client, input.sessionId, input.terminalDeviceId);
      if (!owned.ok) return refuse(owned.refusal, owned.detail);
      const row = owned.row;
      if (row.credential_kind !== "staff") {
        return refuse("SESSION_UNKNOWN", "no such staff session");
      }
      if (await resolveGrant(
        client,
        sessionScope(row),
        row.actor_id,
        PERMISSION_STAFF_SESSIONS_CLOSE
      ) !== "allow") {
        return refuse(
          "SESSION_PERMISSION_DENIED",
          `${PERMISSION_STAFF_SESSIONS_CLOSE} is not granted`
        );
      }
      const nowRow = await client.query(`select now() as now`);
      const now = nowRow.rows[0]?.now ?? /* @__PURE__ */ new Date(0);
      await client.query(
        `update edge_identity.terminal_session set closed_at = now(), status = 'closed' where id = $1::uuid`,
        [row.id]
      );
      const held = await effectivePermissions(client, sessionScope(row), row.actor_id);
      return {
        outcome: "ok",
        result: "SESSION_CLOSED",
        session: {
          sessionId: row.id,
          actorId: row.actor_id,
          displayName: "",
          profileCode: row.profile_code,
          openedAt: row.opened_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          sessionGeneration: row.session_generation,
          effectivePermissions: held,
          authorityTime: now.toISOString()
        }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
var RUNTIME_PROTOCOL_VERSION, AUTHORITY_TIME_MAX_CACHE_AGE_SECONDS, DEV_STAFF_SESSION_LIFETIME_MINUTES, T1_PROFILE_CODE, PERMISSION_STAFF_SESSIONS_OPEN, PERMISSION_STAFF_SESSIONS_READ, PERMISSION_STAFF_SESSIONS_REFRESH, PERMISSION_STAFF_SESSIONS_CLOSE, PERMISSION_POS_T1_USE, PERMISSION_CUSTOMERS_READ, PERMISSION_CUSTOMERS_CREATE, PERMISSION_CONSENT_RECORD, PERMISSION_BOOKINGS_READ, PERMISSION_BOOKINGS_CREATE, T1_TERMINAL_PIN_PERMISSIONS, DEV_DELIVERY_VALIDITY_HOURS;
var init_runtime_bootstrap = __esm({
  "src/hub/edge/runtime-bootstrap.ts"() {
    "use strict";
    init_dist();
    init_dist2();
    init_db();
    init_hub_database();
    RUNTIME_PROTOCOL_VERSION = "1.0";
    AUTHORITY_TIME_MAX_CACHE_AGE_SECONDS = 30;
    DEV_STAFF_SESSION_LIFETIME_MINUTES = 30;
    T1_PROFILE_CODE = "laundry.t1.intake_cashier";
    PERMISSION_STAFF_SESSIONS_OPEN = "staff.sessions.open";
    PERMISSION_STAFF_SESSIONS_READ = "staff.sessions.read";
    PERMISSION_STAFF_SESSIONS_REFRESH = "staff.sessions.refresh";
    PERMISSION_STAFF_SESSIONS_CLOSE = "staff.sessions.close";
    PERMISSION_POS_T1_USE = "pos.t1.use";
    PERMISSION_CUSTOMERS_READ = "customers.read";
    PERMISSION_CUSTOMERS_CREATE = "customers.create";
    PERMISSION_CONSENT_RECORD = "customers.consent.record";
    PERMISSION_BOOKINGS_READ = "laundry.bookings.read";
    PERMISSION_BOOKINGS_CREATE = "laundry.bookings.create";
    T1_TERMINAL_PIN_PERMISSIONS = [
      PERMISSION_POS_T1_USE,
      PERMISSION_CUSTOMERS_READ,
      PERMISSION_CUSTOMERS_CREATE,
      PERMISSION_CONSENT_RECORD,
      PERMISSION_BOOKINGS_READ,
      PERMISSION_BOOKINGS_CREATE
    ];
    DEV_DELIVERY_VALIDITY_HOURS = 24;
  }
});

// ../../node_modules/.pnpm/hash-wasm@4.12.0/node_modules/hash-wasm/dist/index.umd.js
var require_index_umd = __commonJS({
  "../../node_modules/.pnpm/hash-wasm@4.12.0/node_modules/hash-wasm/dist/index.umd.js"(exports, module) {
    (function(global2, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global2 = typeof globalThis !== "undefined" ? globalThis : global2 || self, factory(global2.hashwasm = {}));
    })(exports, (function(exports2) {
      "use strict";
      var name$l = "adler32";
      var data$l = "AGFzbQEAAAABDANgAAF/YAAAYAF/AAMHBgABAgEAAgUEAQECAgYOAn8BQYCJBQt/AEGACAsHcAgGbWVtb3J5AgAOSGFzaF9HZXRCdWZmZXIAAAlIYXNoX0luaXQAAQtIYXNoX1VwZGF0ZQACCkhhc2hfRmluYWwAAw1IYXNoX0dldFN0YXRlAAQOSGFzaF9DYWxjdWxhdGUABQpTVEFURV9TSVpFAwEK6wkGBQBBgAkLCgBBAEEBNgKECAvjCAEHf0EAKAKECCIBQf//A3EhAiABQRB2IQMCQAJAIABBAUcNACACQQAtAIAJaiIBQY+AfGogASABQfD/A0sbIgEgA2oiBEEQdCIFQYCAPGogBSAEQfD/A0sbIAFyIQEMAQsCQAJAAkACQAJAIABBEEkNAEGACSEGIABBsCtJDQFBgAkhBgNAQQAhBQNAIAYgBWoiASgCACIEQf8BcSACaiICIANqIAIgBEEIdkH/AXFqIgJqIAIgBEEQdkH/AXFqIgJqIAIgBEEYdmoiAmogAiABQQRqKAIAIgRB/wFxaiICaiACIARBCHZB/wFxaiICaiACIARBEHZB/wFxaiICaiACIARBGHZqIgJqIAIgAUEIaigCACIEQf8BcWoiAmogAiAEQQh2Qf8BcWoiAmogAiAEQRB2Qf8BcWoiAmogAiAEQRh2aiIEaiAEIAFBDGooAgAiAUH/AXFqIgRqIAQgAUEIdkH/AXFqIgRqIAQgAUEQdkH/AXFqIgRqIAQgAUEYdmoiAmohAyAFQRBqIgVBsCtHDQALIANB8f8DcCEDIAJB8f8DcCECIAZBsCtqIQYgAEHQVGoiAEGvK0sNAAsgAEUNBCAAQQ9LDQEMAgsCQCAARQ0AAkACQCAAQQNxIgUNAEGACSEBIAAhBAwBCyAAQXxxIQRBACEBA0AgAiABQYAJai0AAGoiAiADaiEDIAUgAUEBaiIBRw0ACyAFQYAJaiEBCyAAQQRJDQADQCACIAEtAABqIgUgAS0AAWoiBiABLQACaiIAIAFBA2otAABqIgIgACAGIAUgA2pqamohAyABQQRqIQEgBEF8aiIEDQALCyACQY+AfGogAiACQfD/A0sbIANB8f8DcEEQdHIhAQwECwNAIAYoAgAiAUH/AXEgAmoiBCADaiAEIAFBCHZB/wFxaiIEaiAEIAFBEHZB/wFxaiIEaiAEIAFBGHZqIgRqIAQgBkEEaigCACIBQf8BcWoiBGogBCABQQh2Qf8BcWoiBGogBCABQRB2Qf8BcWoiBGogBCABQRh2aiIEaiAEIAZBCGooAgAiAUH/AXFqIgRqIAQgAUEIdkH/AXFqIgRqIAQgAUEQdkH/AXFqIgRqIAQgAUEYdmoiBGogBCAGQQxqKAIAIgFB/wFxaiIEaiAEIAFBCHZB/wFxaiIEaiAEIAFBEHZB/wFxaiIEaiAEIAFBGHZqIgJqIQMgBkEQaiEGIABBcGoiAEEPSw0ACyAARQ0BCyAAQX9qIQcCQCAAQQNxIgVFDQAgAEF8cSEAIAUhBCAGIQEDQCACIAEtAABqIgIgA2ohAyABQQFqIQEgBEF/aiIEDQALIAYgBWohBgsgB0EDSQ0AA0AgAiAGLQAAaiIBIAYtAAFqIgQgBi0AAmoiBSAGQQNqLQAAaiICIAUgBCABIANqampqIQMgBkEEaiEGIABBfGoiAA0ACwsgA0Hx/wNwIQMgAkHx/wNwIQILIAIgA0EQdHIhAQtBACABNgKECAsxAQF/QQBBACgChAgiAEEYdCAAQYD+A3FBCHRyIABBCHZBgP4DcSAAQRh2cnI2AoAJCwUAQYQICzsAQQBBATYChAggABACQQBBACgChAgiAEEYdCAAQYD+A3FBCHRyIABBCHZBgP4DcSAAQRh2cnI2AoAJCwsVAgBBgAgLBAQAAAAAQYQICwQBAAAA";
      var hash$l = "02ddbd17";
      var wasmJson$l = {
        name: name$l,
        data: data$l,
        hash: hash$l
      };
      function __awaiter(thisArg, _arguments, P, generator) {
        function adopt(value) {
          return value instanceof P ? value : new P(function(resolve) {
            resolve(value);
          });
        }
        return new (P || (P = Promise))(function(resolve, reject) {
          function fulfilled(value) {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          }
          function rejected(value) {
            try {
              step(generator["throw"](value));
            } catch (e) {
              reject(e);
            }
          }
          function step(result) {
            result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
          }
          step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
      }
      typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
      };
      class Mutex {
        constructor() {
          this.mutex = Promise.resolve();
        }
        lock() {
          let begin = () => {
          };
          this.mutex = this.mutex.then(() => new Promise(begin));
          return new Promise((res) => {
            begin = res;
          });
        }
        dispatch(fn) {
          return __awaiter(this, void 0, void 0, function* () {
            const unlock = yield this.lock();
            try {
              return yield Promise.resolve(fn());
            } finally {
              unlock();
            }
          });
        }
      }
      var _a;
      function getGlobal() {
        if (typeof globalThis !== "undefined")
          return globalThis;
        if (typeof self !== "undefined")
          return self;
        if (typeof window !== "undefined")
          return window;
        return global;
      }
      const globalObject = getGlobal();
      const nodeBuffer = (_a = globalObject.Buffer) !== null && _a !== void 0 ? _a : null;
      const textEncoder = globalObject.TextEncoder ? new globalObject.TextEncoder() : null;
      function intArrayToString(arr, len) {
        return String.fromCharCode(...arr.subarray(0, len));
      }
      function hexCharCodesToInt(a, b) {
        return (a & 15) + (a >> 6 | a >> 3 & 8) << 4 | (b & 15) + (b >> 6 | b >> 3 & 8);
      }
      function writeHexToUInt8(buf, str3) {
        const size = str3.length >> 1;
        for (let i = 0; i < size; i++) {
          const index = i << 1;
          buf[i] = hexCharCodesToInt(str3.charCodeAt(index), str3.charCodeAt(index + 1));
        }
      }
      function hexStringEqualsUInt8(str3, buf) {
        if (str3.length !== buf.length * 2) {
          return false;
        }
        for (let i = 0; i < buf.length; i++) {
          const strIndex = i << 1;
          if (buf[i] !== hexCharCodesToInt(str3.charCodeAt(strIndex), str3.charCodeAt(strIndex + 1))) {
            return false;
          }
        }
        return true;
      }
      const alpha = "a".charCodeAt(0) - 10;
      const digit = "0".charCodeAt(0);
      function getDigestHex(tmpBuffer, input, hashLength) {
        let p = 0;
        for (let i = 0; i < hashLength; i++) {
          let nibble = input[i] >>> 4;
          tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
          nibble = input[i] & 15;
          tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
        }
        return String.fromCharCode.apply(null, tmpBuffer);
      }
      const getUInt8Buffer = nodeBuffer !== null ? (data2) => {
        if (typeof data2 === "string") {
          const buf = nodeBuffer.from(data2, "utf8");
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
        }
        if (nodeBuffer.isBuffer(data2)) {
          return new Uint8Array(data2.buffer, data2.byteOffset, data2.length);
        }
        if (ArrayBuffer.isView(data2)) {
          return new Uint8Array(data2.buffer, data2.byteOffset, data2.byteLength);
        }
        throw new Error("Invalid data type!");
      } : (data2) => {
        if (typeof data2 === "string") {
          return textEncoder.encode(data2);
        }
        if (ArrayBuffer.isView(data2)) {
          return new Uint8Array(data2.buffer, data2.byteOffset, data2.byteLength);
        }
        throw new Error("Invalid data type!");
      };
      const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const base64Lookup = new Uint8Array(256);
      for (let i = 0; i < base64Chars.length; i++) {
        base64Lookup[base64Chars.charCodeAt(i)] = i;
      }
      function encodeBase64(data2, pad = true) {
        const len = data2.length;
        const extraBytes = len % 3;
        const parts = [];
        const len2 = len - extraBytes;
        for (let i = 0; i < len2; i += 3) {
          const tmp = (data2[i] << 16 & 16711680) + (data2[i + 1] << 8 & 65280) + (data2[i + 2] & 255);
          const triplet = base64Chars.charAt(tmp >> 18 & 63) + base64Chars.charAt(tmp >> 12 & 63) + base64Chars.charAt(tmp >> 6 & 63) + base64Chars.charAt(tmp & 63);
          parts.push(triplet);
        }
        if (extraBytes === 1) {
          const tmp = data2[len - 1];
          const a = base64Chars.charAt(tmp >> 2);
          const b = base64Chars.charAt(tmp << 4 & 63);
          parts.push(`${a}${b}`);
          if (pad) {
            parts.push("==");
          }
        } else if (extraBytes === 2) {
          const tmp = (data2[len - 2] << 8) + data2[len - 1];
          const a = base64Chars.charAt(tmp >> 10);
          const b = base64Chars.charAt(tmp >> 4 & 63);
          const c = base64Chars.charAt(tmp << 2 & 63);
          parts.push(`${a}${b}${c}`);
          if (pad) {
            parts.push("=");
          }
        }
        return parts.join("");
      }
      function getDecodeBase64Length(data2) {
        let bufferLength = Math.floor(data2.length * 0.75);
        const len = data2.length;
        if (data2[len - 1] === "=") {
          bufferLength -= 1;
          if (data2[len - 2] === "=") {
            bufferLength -= 1;
          }
        }
        return bufferLength;
      }
      function decodeBase64(data2) {
        const bufferLength = getDecodeBase64Length(data2);
        const len = data2.length;
        const bytes = new Uint8Array(bufferLength);
        let p = 0;
        for (let i = 0; i < len; i += 4) {
          const encoded1 = base64Lookup[data2.charCodeAt(i)];
          const encoded2 = base64Lookup[data2.charCodeAt(i + 1)];
          const encoded3 = base64Lookup[data2.charCodeAt(i + 2)];
          const encoded4 = base64Lookup[data2.charCodeAt(i + 3)];
          bytes[p] = encoded1 << 2 | encoded2 >> 4;
          p += 1;
          bytes[p] = (encoded2 & 15) << 4 | encoded3 >> 2;
          p += 1;
          bytes[p] = (encoded3 & 3) << 6 | encoded4 & 63;
          p += 1;
        }
        return bytes;
      }
      const MAX_HEAP = 16 * 1024;
      const WASM_FUNC_HASH_LENGTH = 4;
      const wasmMutex = new Mutex();
      const wasmModuleCache = /* @__PURE__ */ new Map();
      function WASMInterface(binary, hashLength) {
        return __awaiter(this, void 0, void 0, function* () {
          let wasmInstance = null;
          let memoryView = null;
          let initialized = false;
          if (typeof WebAssembly === "undefined") {
            throw new Error("WebAssembly is not supported in this environment!");
          }
          const writeMemory = (data2, offset = 0) => {
            memoryView.set(data2, offset);
          };
          const getMemory = () => memoryView;
          const getExports = () => wasmInstance.exports;
          const setMemorySize = (totalSize) => {
            wasmInstance.exports.Hash_SetMemorySize(totalSize);
            const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
            const memoryBuffer = wasmInstance.exports.memory.buffer;
            memoryView = new Uint8Array(memoryBuffer, arrayOffset, totalSize);
          };
          const getStateSize = () => {
            const view = new DataView(wasmInstance.exports.memory.buffer);
            const stateSize = view.getUint32(wasmInstance.exports.STATE_SIZE, true);
            return stateSize;
          };
          const loadWASMPromise = wasmMutex.dispatch(() => __awaiter(this, void 0, void 0, function* () {
            if (!wasmModuleCache.has(binary.name)) {
              const asm = decodeBase64(binary.data);
              const promise = WebAssembly.compile(asm);
              wasmModuleCache.set(binary.name, promise);
            }
            const module2 = yield wasmModuleCache.get(binary.name);
            wasmInstance = yield WebAssembly.instantiate(module2, {
              // env: {
              //   emscripten_memcpy_big: (dest, src, num) => {
              //     const memoryBuffer = wasmInstance.exports.memory.buffer;
              //     const memView = new Uint8Array(memoryBuffer, 0);
              //     memView.set(memView.subarray(src, src + num), dest);
              //   },
              //   print_memory: (offset, len) => {
              //     const memoryBuffer = wasmInstance.exports.memory.buffer;
              //     const memView = new Uint8Array(memoryBuffer, 0);
              //     console.log('print_int32', memView.subarray(offset, offset + len));
              //   },
              // },
            });
          }));
          const setupInterface = () => __awaiter(this, void 0, void 0, function* () {
            if (!wasmInstance) {
              yield loadWASMPromise;
            }
            const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
            const memoryBuffer = wasmInstance.exports.memory.buffer;
            memoryView = new Uint8Array(memoryBuffer, arrayOffset, MAX_HEAP);
          });
          const init = (bits = null) => {
            initialized = true;
            wasmInstance.exports.Hash_Init(bits);
          };
          const updateUInt8Array = (data2) => {
            let read = 0;
            while (read < data2.length) {
              const chunk = data2.subarray(read, read + MAX_HEAP);
              read += chunk.length;
              memoryView.set(chunk);
              wasmInstance.exports.Hash_Update(chunk.length);
            }
          };
          const update = (data2) => {
            if (!initialized) {
              throw new Error("update() called before init()");
            }
            const Uint8Buffer = getUInt8Buffer(data2);
            updateUInt8Array(Uint8Buffer);
          };
          const digestChars = new Uint8Array(hashLength * 2);
          const digest = (outputType, padding = null) => {
            if (!initialized) {
              throw new Error("digest() called before init()");
            }
            initialized = false;
            wasmInstance.exports.Hash_Final(padding);
            if (outputType === "binary") {
              return memoryView.slice(0, hashLength);
            }
            return getDigestHex(digestChars, memoryView, hashLength);
          };
          const save = () => {
            if (!initialized) {
              throw new Error("save() can only be called after init() and before digest()");
            }
            const stateOffset = wasmInstance.exports.Hash_GetState();
            const stateLength = getStateSize();
            const memoryBuffer = wasmInstance.exports.memory.buffer;
            const internalState = new Uint8Array(memoryBuffer, stateOffset, stateLength);
            const prefixedState = new Uint8Array(WASM_FUNC_HASH_LENGTH + stateLength);
            writeHexToUInt8(prefixedState, binary.hash);
            prefixedState.set(internalState, WASM_FUNC_HASH_LENGTH);
            return prefixedState;
          };
          const load = (state) => {
            if (!(state instanceof Uint8Array)) {
              throw new Error("load() expects an Uint8Array generated by save()");
            }
            const stateOffset = wasmInstance.exports.Hash_GetState();
            const stateLength = getStateSize();
            const overallLength = WASM_FUNC_HASH_LENGTH + stateLength;
            const memoryBuffer = wasmInstance.exports.memory.buffer;
            if (state.length !== overallLength) {
              throw new Error(`Bad state length (expected ${overallLength} bytes, got ${state.length})`);
            }
            if (!hexStringEqualsUInt8(binary.hash, state.subarray(0, WASM_FUNC_HASH_LENGTH))) {
              throw new Error("This state was written by an incompatible hash implementation");
            }
            const internalState = state.subarray(WASM_FUNC_HASH_LENGTH);
            new Uint8Array(memoryBuffer, stateOffset, stateLength).set(internalState);
            initialized = true;
          };
          const isDataShort = (data2) => {
            if (typeof data2 === "string") {
              return data2.length < MAX_HEAP / 4;
            }
            return data2.byteLength < MAX_HEAP;
          };
          let canSimplify = isDataShort;
          switch (binary.name) {
            case "argon2":
            case "scrypt":
              canSimplify = () => true;
              break;
            case "blake2b":
            case "blake2s":
              canSimplify = (data2, initParam) => initParam <= 512 && isDataShort(data2);
              break;
            case "blake3":
              canSimplify = (data2, initParam) => initParam === 0 && isDataShort(data2);
              break;
            case "xxhash64":
            // cannot simplify
            case "xxhash3":
            case "xxhash128":
            case "crc64":
              canSimplify = () => false;
              break;
          }
          const calculate = (data2, initParam = null, digestParam = null) => {
            if (!canSimplify(data2, initParam)) {
              init(initParam);
              update(data2);
              return digest("hex", digestParam);
            }
            const buffer = getUInt8Buffer(data2);
            memoryView.set(buffer);
            wasmInstance.exports.Hash_Calculate(buffer.length, initParam, digestParam);
            return getDigestHex(digestChars, memoryView, hashLength);
          };
          yield setupInterface();
          return {
            getMemory,
            writeMemory,
            getExports,
            setMemorySize,
            init,
            update,
            digest,
            save,
            load,
            calculate,
            hashLength
          };
        });
      }
      function lockedCreate(mutex2, binary, hashLength) {
        return __awaiter(this, void 0, void 0, function* () {
          const unlock = yield mutex2.lock();
          const wasm = yield WASMInterface(binary, hashLength);
          unlock();
          return wasm;
        });
      }
      const mutex$l = new Mutex();
      let wasmCache$l = null;
      function adler32(data2) {
        if (wasmCache$l === null) {
          return lockedCreate(mutex$l, wasmJson$l, 4).then((wasm) => {
            wasmCache$l = wasm;
            return wasmCache$l.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache$l.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createAdler32() {
        return WASMInterface(wasmJson$l, 4).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 4,
            digestSize: 4
          };
          return obj;
        });
      }
      var name$k = "argon2";
      var data$k = "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQZCoBAsHQQQGbWVtb3J5AgASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECvEyBVgBAn9BACEBAkAgAEEAKAKICCICRg0AAkAgACACayIAQRB2IABBgIB8cSAASWoiAEAAQX9HDQBB/wHADwtBACEBQQBBACkDiAggAEEQdK18NwOICAsgAcALcAECfwJAQQAoAoAIIgANAEEAPwBBEHQiADYCgAhBACgCiAgiAUGAgCBGDQACQEGAgCAgAWsiAEEQdiAAQYCAfHEgAElqIgBAAEF/Rw0AQQAPC0EAQQApA4gIIABBEHStfDcDiAhBACgCgAghAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC98aAQN/QQAhBEEAIAIpAwAgASkDAIU3A5AIQQAgAikDCCABKQMIhTcDmAhBACACKQMQIAEpAxCFNwOgCEEAIAIpAxggASkDGIU3A6gIQQAgAikDICABKQMghTcDsAhBACACKQMoIAEpAyiFNwO4CEEAIAIpAzAgASkDMIU3A8AIQQAgAikDOCABKQM4hTcDyAhBACACKQNAIAEpA0CFNwPQCEEAIAIpA0ggASkDSIU3A9gIQQAgAikDUCABKQNQhTcD4AhBACACKQNYIAEpA1iFNwPoCEEAIAIpA2AgASkDYIU3A/AIQQAgAikDaCABKQNohTcD+AhBACACKQNwIAEpA3CFNwOACUEAIAIpA3ggASkDeIU3A4gJQQAgAikDgAEgASkDgAGFNwOQCUEAIAIpA4gBIAEpA4gBhTcDmAlBACACKQOQASABKQOQAYU3A6AJQQAgAikDmAEgASkDmAGFNwOoCUEAIAIpA6ABIAEpA6ABhTcDsAlBACACKQOoASABKQOoAYU3A7gJQQAgAikDsAEgASkDsAGFNwPACUEAIAIpA7gBIAEpA7gBhTcDyAlBACACKQPAASABKQPAAYU3A9AJQQAgAikDyAEgASkD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";
      var hash$k = "e4cdc523";
      var wasmJson$k = {
        name: name$k,
        data: data$k,
        hash: hash$k
      };
      var name$j = "blake2b";
      var data$j = "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";
      var hash$j = "c6f286e6";
      var wasmJson$j = {
        name: name$j,
        data: data$j,
        hash: hash$j
      };
      const mutex$k = new Mutex();
      let wasmCache$k = null;
      function validateBits$4(bits) {
        if (!Number.isInteger(bits) || bits < 8 || bits > 512 || bits % 8 !== 0) {
          return new Error("Invalid variant! Valid values: 8, 16, ..., 512");
        }
        return null;
      }
      function getInitParam$1(outputBits, keyBits) {
        return outputBits | keyBits << 16;
      }
      function blake2b(data2, bits = 512, key = null) {
        if (validateBits$4(bits)) {
          return Promise.reject(validateBits$4(bits));
        }
        let keyBuffer = null;
        let initParam = bits;
        if (key !== null) {
          keyBuffer = getUInt8Buffer(key);
          if (keyBuffer.length > 64) {
            return Promise.reject(new Error("Max key length is 64 bytes"));
          }
          initParam = getInitParam$1(bits, keyBuffer.length);
        }
        const hashLength = bits / 8;
        if (wasmCache$k === null || wasmCache$k.hashLength !== hashLength) {
          return lockedCreate(mutex$k, wasmJson$j, hashLength).then((wasm) => {
            wasmCache$k = wasm;
            if (initParam > 512) {
              wasmCache$k.writeMemory(keyBuffer);
            }
            return wasmCache$k.calculate(data2, initParam);
          });
        }
        try {
          if (initParam > 512) {
            wasmCache$k.writeMemory(keyBuffer);
          }
          const hash2 = wasmCache$k.calculate(data2, initParam);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createBLAKE2b(bits = 512, key = null) {
        if (validateBits$4(bits)) {
          return Promise.reject(validateBits$4(bits));
        }
        let keyBuffer = null;
        let initParam = bits;
        if (key !== null) {
          keyBuffer = getUInt8Buffer(key);
          if (keyBuffer.length > 64) {
            return Promise.reject(new Error("Max key length is 64 bytes"));
          }
          initParam = getInitParam$1(bits, keyBuffer.length);
        }
        const outputSize = bits / 8;
        return WASMInterface(wasmJson$j, outputSize).then((wasm) => {
          if (initParam > 512) {
            wasm.writeMemory(keyBuffer);
          }
          wasm.init(initParam);
          const obj = {
            init: initParam > 512 ? () => {
              wasm.writeMemory(keyBuffer);
              wasm.init(initParam);
              return obj;
            } : () => {
              wasm.init(initParam);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 128,
            digestSize: outputSize
          };
          return obj;
        });
      }
      function encodeResult(salt, options, res) {
        const parameters = [
          `m=${options.memorySize}`,
          `t=${options.iterations}`,
          `p=${options.parallelism}`
        ].join(",");
        return `$argon2${options.hashType}$v=19$${parameters}$${encodeBase64(salt, false)}$${encodeBase64(res, false)}`;
      }
      const uint32View = new DataView(new ArrayBuffer(4));
      function int32LE(x) {
        uint32View.setInt32(0, x, true);
        return new Uint8Array(uint32View.buffer);
      }
      function hashFunc(blake512, buf, len) {
        return __awaiter(this, void 0, void 0, function* () {
          if (len <= 64) {
            const blake = yield createBLAKE2b(len * 8);
            blake.update(int32LE(len));
            blake.update(buf);
            return blake.digest("binary");
          }
          const r = Math.ceil(len / 32) - 2;
          const ret = new Uint8Array(len);
          blake512.init();
          blake512.update(int32LE(len));
          blake512.update(buf);
          let vp = blake512.digest("binary");
          ret.set(vp.subarray(0, 32), 0);
          for (let i = 1; i < r; i++) {
            blake512.init();
            blake512.update(vp);
            vp = blake512.digest("binary");
            ret.set(vp.subarray(0, 32), i * 32);
          }
          const partialBytesNeeded = len - 32 * r;
          let blakeSmall;
          if (partialBytesNeeded === 64) {
            blakeSmall = blake512;
            blakeSmall.init();
          } else {
            blakeSmall = yield createBLAKE2b(partialBytesNeeded * 8);
          }
          blakeSmall.update(vp);
          vp = blakeSmall.digest("binary");
          ret.set(vp.subarray(0, partialBytesNeeded), r * 32);
          return ret;
        });
      }
      function getHashType(type) {
        switch (type) {
          case "d":
            return 0;
          case "i":
            return 1;
          default:
            return 2;
        }
      }
      function argon2Internal(options) {
        return __awaiter(this, void 0, void 0, function* () {
          var _a2;
          const { parallelism, iterations, hashLength } = options;
          const password = getUInt8Buffer(options.password);
          const salt = getUInt8Buffer(options.salt);
          const version = 19;
          const hashType = getHashType(options.hashType);
          const { memorySize } = options;
          const secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
          const [argon2Interface, blake512] = yield Promise.all([
            WASMInterface(wasmJson$k, 1024),
            createBLAKE2b(512)
          ]);
          argon2Interface.setMemorySize(memorySize * 1024 + 1024);
          const initVector = new Uint8Array(24);
          const initVectorView = new DataView(initVector.buffer);
          initVectorView.setInt32(0, parallelism, true);
          initVectorView.setInt32(4, hashLength, true);
          initVectorView.setInt32(8, memorySize, true);
          initVectorView.setInt32(12, iterations, true);
          initVectorView.setInt32(16, version, true);
          initVectorView.setInt32(20, hashType, true);
          argon2Interface.writeMemory(initVector, memorySize * 1024);
          blake512.init();
          blake512.update(initVector);
          blake512.update(int32LE(password.length));
          blake512.update(password);
          blake512.update(int32LE(salt.length));
          blake512.update(salt);
          blake512.update(int32LE(secret.length));
          blake512.update(secret);
          blake512.update(int32LE(0));
          const segments = Math.floor(memorySize / (parallelism * 4));
          const lanes = segments * 4;
          const param = new Uint8Array(72);
          const H0 = blake512.digest("binary");
          param.set(H0);
          for (let lane = 0; lane < parallelism; lane++) {
            param.set(int32LE(0), 64);
            param.set(int32LE(lane), 68);
            let position = lane * lanes;
            let chunk = yield hashFunc(blake512, param, 1024);
            argon2Interface.writeMemory(chunk, position * 1024);
            position += 1;
            param.set(int32LE(1), 64);
            chunk = yield hashFunc(blake512, param, 1024);
            argon2Interface.writeMemory(chunk, position * 1024);
          }
          const C = new Uint8Array(1024);
          writeHexToUInt8(C, argon2Interface.calculate(new Uint8Array([]), memorySize));
          const res = yield hashFunc(blake512, C, hashLength);
          if (options.outputType === "hex") {
            const digestChars = new Uint8Array(hashLength * 2);
            return getDigestHex(digestChars, res, hashLength);
          }
          if (options.outputType === "encoded") {
            return encodeResult(salt, options, res);
          }
          return res;
        });
      }
      const validateOptions$3 = (options) => {
        var _a2;
        if (!options || typeof options !== "object") {
          throw new Error("Invalid options parameter. It requires an object.");
        }
        if (!options.password) {
          throw new Error("Password must be specified");
        }
        options.password = getUInt8Buffer(options.password);
        if (options.password.length < 1) {
          throw new Error("Password must be specified");
        }
        if (!options.salt) {
          throw new Error("Salt must be specified");
        }
        options.salt = getUInt8Buffer(options.salt);
        if (options.salt.length < 8) {
          throw new Error("Salt should be at least 8 bytes long");
        }
        options.secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
        if (!Number.isInteger(options.iterations) || options.iterations < 1) {
          throw new Error("Iterations should be a positive number");
        }
        if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
          throw new Error("Parallelism should be a positive number");
        }
        if (!Number.isInteger(options.hashLength) || options.hashLength < 4) {
          throw new Error("Hash length should be at least 4 bytes.");
        }
        if (!Number.isInteger(options.memorySize)) {
          throw new Error("Memory size should be specified.");
        }
        if (options.memorySize < 8 * options.parallelism) {
          throw new Error("Memory size should be at least 8 * parallelism.");
        }
        if (options.outputType === void 0) {
          options.outputType = "hex";
        }
        if (!["hex", "binary", "encoded"].includes(options.outputType)) {
          throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
        }
      };
      function argon2i(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateOptions$3(options);
          return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "i" }));
        });
      }
      function argon2id2(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateOptions$3(options);
          return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "id" }));
        });
      }
      function argon2d(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateOptions$3(options);
          return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "d" }));
        });
      }
      const getHashParameters = (password, encoded, secret) => {
        const regex = /^\$argon2(id|i|d)\$v=([0-9]+)\$((?:[mtp]=[0-9]+,){2}[mtp]=[0-9]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
        const match = encoded.match(regex);
        if (!match) {
          throw new Error("Invalid hash");
        }
        const [, hashType, version, parameters, salt, hash2] = match;
        if (version !== "19") {
          throw new Error(`Unsupported version: ${version}`);
        }
        const parsedParameters = {};
        const paramMap = { m: "memorySize", p: "parallelism", t: "iterations" };
        for (const x of parameters.split(",")) {
          const [n, v] = x.split("=");
          parsedParameters[paramMap[n]] = Number(v);
        }
        return Object.assign(Object.assign({}, parsedParameters), {
          password,
          secret,
          hashType,
          salt: decodeBase64(salt),
          hashLength: getDecodeBase64Length(hash2),
          outputType: "encoded"
        });
      };
      const validateVerifyOptions$1 = (options) => {
        if (!options || typeof options !== "object") {
          throw new Error("Invalid options parameter. It requires an object.");
        }
        if (options.hash === void 0 || typeof options.hash !== "string") {
          throw new Error("Hash should be specified");
        }
      };
      function argon2Verify2(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateVerifyOptions$1(options);
          const params = getHashParameters(options.password, options.hash, options.secret);
          validateOptions$3(params);
          const hashStart = options.hash.lastIndexOf("$") + 1;
          const result = yield argon2Internal(params);
          return result.substring(hashStart) === options.hash.substring(hashStart);
        });
      }
      var name$i = "blake2s";
      var data$i = "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";
      var hash$i = "5c0ff166";
      var wasmJson$i = {
        name: name$i,
        data: data$i,
        hash: hash$i
      };
      const mutex$j = new Mutex();
      let wasmCache$j = null;
      function validateBits$3(bits) {
        if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) {
          return new Error("Invalid variant! Valid values: 8, 16, ..., 256");
        }
        return null;
      }
      function getInitParam(outputBits, keyBits) {
        return outputBits | keyBits << 16;
      }
      function blake2s(data2, bits = 256, key = null) {
        if (validateBits$3(bits)) {
          return Promise.reject(validateBits$3(bits));
        }
        let keyBuffer = null;
        let initParam = bits;
        if (key !== null) {
          keyBuffer = getUInt8Buffer(key);
          if (keyBuffer.length > 32) {
            return Promise.reject(new Error("Max key length is 32 bytes"));
          }
          initParam = getInitParam(bits, keyBuffer.length);
        }
        const hashLength = bits / 8;
        if (wasmCache$j === null || wasmCache$j.hashLength !== hashLength) {
          return lockedCreate(mutex$j, wasmJson$i, hashLength).then((wasm) => {
            wasmCache$j = wasm;
            if (initParam > 512) {
              wasmCache$j.writeMemory(keyBuffer);
            }
            return wasmCache$j.calculate(data2, initParam);
          });
        }
        try {
          if (initParam > 512) {
            wasmCache$j.writeMemory(keyBuffer);
          }
          const hash2 = wasmCache$j.calculate(data2, initParam);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createBLAKE2s(bits = 256, key = null) {
        if (validateBits$3(bits)) {
          return Promise.reject(validateBits$3(bits));
        }
        let keyBuffer = null;
        let initParam = bits;
        if (key !== null) {
          keyBuffer = getUInt8Buffer(key);
          if (keyBuffer.length > 32) {
            return Promise.reject(new Error("Max key length is 32 bytes"));
          }
          initParam = getInitParam(bits, keyBuffer.length);
        }
        const outputSize = bits / 8;
        return WASMInterface(wasmJson$i, outputSize).then((wasm) => {
          if (initParam > 512) {
            wasm.writeMemory(keyBuffer);
          }
          wasm.init(initParam);
          const obj = {
            init: initParam > 512 ? () => {
              wasm.writeMemory(keyBuffer);
              wasm.init(initParam);
              return obj;
            } : () => {
              wasm.init(initParam);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: outputSize
          };
          return obj;
        });
      }
      var name$h = "blake3";
      var data$h = "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IQEgAkFAaiICQcAASw0ACwsCQEHAACAHQf8BcSIGayIFIAIgBSACSRsiCUUNACAJQQNxIQtBACEFAkAgCUEESQ0AIAAgBmohByAJQfwAcSEIQQAhBQNAIAcgBWoiAkEoaiABIAVqIgotAAA6AAAgAkEpaiAKQQFqLQAAOgAAIAJBKmogCkECai0AADoAACACQStqIApBA2otAAA6AAAgCCAFQQRqIgVHDQALCwJAIAtFDQAgASAFaiEBIAUgBmogAGpBKGohBQNAIAUgAS0AADoAACABQQFqIQEgBUEBaiEFIAtBf2oiCw0ACwsgAC0AaCEHCyAAIAcgCWo6AGggA0HAAGokAAveAwQFfwN+BX8GfiMAQdABayIBJAACQCAAe6ciAkEALQCQigEiA08NAEEALQCKigFBBHIhBCABQShqIQVBACkDmIkBIQBBACkDkIkBIQZBACkDiIkBIQdBACkDgIkBIQggAyEJA0AgASAANwMYIAEgBjcDECABIAc3AwggASAINwMAIAEgA0EFdCIDQdGJAWoiCikDADcDKCABIANB2YkBaiILKQMANwMwIAEgA0HhiQFqIgwpAwA3AzggASADQemJAWoiDSkDADcDQCABIANB8YkBaikDADcDSCABIANB+YkBaikDADcDUCABIANBgYoBaikDADcDWCADQYmKAWopAwAhDiABQcAAOgBoIAEgDjcDYCABQgA3AyAgASAEOgBpIAEgADcDiAEgASAGNwOAASABIAc3A3ggASAINwNwIAFBkAFqIAFB8ABqIAVBwABCACAEQf8BcRACIAEpA7ABIQ4gASkDkAEhDyABKQO4ASEQIAEpA5gBIREgASkDwAEhEiABKQOgASETIA0gASkDyAEgASkDqAGFNwMAIAwgEiAThTcDACALIBAgEYU3AwAgCiAOIA+FNwMAIAlBf2oiCUH/AXEiAyACSw0AC0EAIAk6AJCKAQsgAUHQAWokAAvHCQIKfwV+IwBB4AJrIgUkAAJAAkAgAUGACEsNACAFIAA2AvwBIAVB/AFqIAFBgAhGIgZBECACQQEgA0EBQQIgBBABIAZBCnQiByABTw0BIAVB4ABqIgZCADcDACAFQdgAaiIIQgA3AwAgBUHQAGoiCUIANwMAIAVByABqIgpCADcDACAFQcAAaiILQgA3AwAgBUE4aiIMQgA3AwAgBUEwaiINQgA3AwAgBSADOgBqIAVCADcDKCAFQQA7AWggBUEAKQOAiQE3AwAgBUEAKQOIiQE3AwggBUEAKQOQiQE3AxAgBUEAKQOYiQE3AxggBSABQYAIRiIOrSACfDcDICAFIAAgB2pBACABIA4bEAQgBUGIAWpBMGogDSkDADcDACAFQYgBakE4aiAMKQMANwMAIAUgBSkDACIPNwOIASAFIAUpAwgiEDcDkAEgBSAFKQMQIhE3A5gBIAUgBSkDGCISNwOgASAFIAUpAyg3A7ABIAUtAGohACAFLQBpIQcgBSkDICECIAUtAGghASAFQYgBakHAAGogCykDADcDACAFQYgBakHIAGogCikDADcDACAFQYgBakHQAGogCSkDADcDACAFQYgBakHYAGogCCkDADcDACAFQYgBakHgAGogBikDADcDACAFIAE6APABIAUgAjcDqAEgBSAAIAdFckECciIAOgDxASAFIBI3A5gCIAUgETcDkAIgBSAQNwOIAiAFIA83A4ACIAVBoAJqIAVBgAJqIAVBsAFqIAEgAiAAQf8BcRACIAUpA8ACIQIgBSkDoAIhDyAFKQPIAiEQIAUpA6gCIREgBSkD0AIhEiAFKQOwAiETIAQgDkEFdGoiASAFKQPYAiAFKQO4AoU3AxggASASIBOFNwMQIAEgECARhTcDCCABIAIgD4U3AwBBAkEBIA4bIQYMAQsgAEIBIAFBf2pBCnZBAXKteUI/hYYiD6dBCnQiDiACIAMgBRAGIQcgACAOaiABIA5rIA9C////AYMgAnwgAyAFQcAAQSAgDkGACEsbahAGIQECQCAHQQFHDQAgBCAFKQMANwMAIAQgBSkDCDcDCCAEIAUpAxA3AxAgBCAFKQMYNwMYIAQgBSkDIDcDICAEIAUpAyg3AyggBCAFKQMwNwMwIAQgBSkDODcDOEECIQYMAQtBACEGQQAhAAJAIAEgB2oiCUECSQ0AIAlBfmoiCkEBdkEBaiIGQQNxIQ5BACEHAkAgCkEGSQ0AIAZB/P///wdxIQhBACEHIAVBiAFqIQEgBSEAA0AgASAANgIAIAFBDGogAEHAAWo2AgAgAUEIaiAAQYABajYCACABQQRqIABBwABqNgIAIABBgAJqIQAgAUEQaiEBIAggB0EEaiIHRw0ACwsgCkF+cSEIAkAgDkUNACAFIAdBBnRqIQEgBUGIAWogB0ECdGohAANAIAAgATYCACABQcAAaiEBIABBBGohACAOQX9qIg4NAAsLIAhBAmohAAsgBUGIAWogBkEBQgBBACADQQRyQQBBACAEEAEgACAJTw0AIAQgBkEFdGoiASAFIAZBBnRqIgApAwA3AwAgASAAKQMINwMIIAEgACkDEDcDECABIAApAxg3AxggBkEBaiEGCyAFQeACaiQAIAYLrRAIAn8EfgF/AX4EfwR+BH8EfiMAQfABayIBJAACQCAARQ0AAkBBAC0AkIoBIgINACABQTBqQQApA9CJATcDACABQThqQQApA9iJATcDACABQQApA6CJASIDNwMAIAFBACkDqIkBIgQ3AwggAUEAKQOwiQEiBTcDECABQQApA7iJASIGNwMYIAFBACkDyIkBNwMoQQAtAIqKASECQQAtAImKASEHQQApA8CJASEIQQAtAIiKASEJIAFBwABqQQApA+CJATcDACABQcgAakEAKQPoiQE3AwAgAUHQAGpBACkD8IkBNwMAIAFB2ABqQQApA/iJATcDACABQeAAakEAKQOAigE3AwAgASAJOgBoIAEgCDcDICABIAIgB0VyIgJBAnI6AGkgAUEoaiEKQgAhCEGACSELIAJBCnJB/wFxIQwDQCABQbABaiABIAogCUH/AXEgCCAMEAIgASABKQPQASINIAEpA7ABhTcDcCABIAEpA9gBIg4gASkDuAGFNwN4IAEgASkD4AEiDyABKQPAAYU3A4ABIAEgASkD6AEiECAGhTcDqAEgASAPIAWFNwOgASABIA4gBIU3A5gBIAEgDSADhTcDkAEgASAQIAEpA8gBhTcDiAEgAEHAACAAQcAASRsiEUF/aiESAkACQCARQQdxIhMNACABQfAAaiECIAshByARIRQMAQsgEUH4AHEhFCABQfAAaiECIAshBwNAIAcgAi0AADoAACAHQQFqIQcgAkEBaiECIBNBf2oiEw0ACwsCQCASQQdJDQADQCAHIAIpAAA3AAAgB0EIaiEHIAJBCGohAiAUQXhqIhQNAAsLIAhCAXwhCCALIBFqIQsgACARayIADQAMAgsLAkACQAJAQQAtAImKASIHQQZ0QQBBAC0AiIoBIhFrRg0AIAEgEToAaCABQQApA4CKATcDYCABQQApA/iJATcDWCABQQApA/CJATcDUCABQQApA+iJATcDSCABQQApA+CJATcDQCABQQApA9iJATcDOCABQQApA9CJATcDMCABQQApA8iJATcDKCABQQApA8CJASIINwMgIAFBACkDuIkBIgM3AxggAUEAKQOwiQEiBDcDECABQQApA6iJASIFNwMIIAFBACkDoIkBIgY3AwAgAUEALQCKigEiEyAHRXJBAnIiCzoAaSATQQRyIRNBACkDmIkBIQ1BACkDkIkBIQ5BACkDiIkBIQ9BACkDgIkBIRAMAQtBwAAhESABQcAAOgBoQgAhCCABQgA3AyAgAUEAKQOYiQEiDTcDGCABQQApA5CJASIONwMQIAFBACkDiIkBIg83AwggAUEAKQOAiQEiEDcDACABQQAtAIqKAUEEciITOgBpIAEgAkF+aiICQQV0IgdByYoBaikDADcDYCABIAdBwYoBaikDADcDWCABIAdBuYoBaikDADcDUCABIAdBsYoBaikDADcDSCABIAdBqYoBaikDADcDQCABIAdBoYoBaikDADcDOCABIAdBmYoBaikDADcDMCABIAdBkYoBaikDADcDKCATIQsgECEGIA8hBSAOIQQgDSEDIAJFDQELIAJBf2oiB0EFdCIUQZGKAWopAwAhFSAUQZmKAWopAwAhFiAUQaGKAWopAwAhFyAUQamKAWopAwAhGCABIAM3A4gBIAEgBDcDgAEgASAFNwN4IAEgBjcDcCABQbABaiABQfAAaiABQShqIhQgESAIIAtB/wFxEAIgASATOgBpIAFBwAA6AGggASAYNwNAIAEgFzcDOCABIBY3AzAgASAVNwMoIAFCADcDICABIA03AxggASAONwMQIAEgDzcDCCABIBA3AwAgASABKQPoASABKQPIAYU3A2AgASABKQPgASABKQPAAYU3A1ggASABKQPYASABKQO4AYU3A1AgASABKQPQASABKQOwAYU3A0ggB0UNACACQQV0QemJAWohAiATQf8BcSERA0AgAkFoaikDACEIIAJBcGopAwAhAyACQXhqKQMAIQQgAikDACEFIAEgDTcDiAEgASAONwOAASABIA83A3ggASAQNwNwIAFBsAFqIAFB8ABqIBRBwABCACAREAIgASATOgBpIAFBwAA6AGggASAFNwNAIAEgBDcDOCABIAM3AzAgASAINwMoIAFCADcDICABIA03AxggASAONwMQIAEgDzcDCCABIBA3AwAgASABKQPoASABKQPIAYU3A2AgASABKQPgASABKQPAAYU3A1ggASABKQPYASABKQO4AYU3A1AgASABKQPQASABKQOwAYU3A0ggAkFgaiECIAdBf2oiBw0ACwsgAUEoaiEJQgAhCEGACSELIBNBCHJB/wFxIQoDQCABQbABaiABIAlBwAAgCCAKEAIgASABKQPQASIDIAEpA7ABhTcDcCABIAEpA9gBIgQgASkDuAGFNwN4IAEgASkD4AEiBSABKQPAAYU3A4ABIAEgDSABKQPoASIGhTcDqAEgASAOIAWFNwOgASABIA8gBIU3A5gBIAEgECADhTcDkAEgASAGIAEpA8gBhTcDiAEgAEHAACAAQcAASRsiEUF/aiESAkACQCARQQdxIhMNACABQfAAaiECIAshByARIRQMAQsgEUH4AHEhFCABQfAAaiECIAshBwNAIAcgAi0AADoAACAHQQFqIQcgAkEBaiECIBNBf2oiEw0ACwsCQCASQQdJDQADQCAHIAIpAAA3AAAgB0EIaiEHIAJBCGohAiAUQXhqIhQNAAsLIAhCAXwhCCALIBFqIQsgACARayIADQALCyABQfABaiQAC6MCAQR+AkACQCAAQSBGDQBCq7OP/JGjs/DbACEBQv+kuYjFkdqCm38hAkLy5rvjo6f9p6V/IQNC58yn0NbQ67O7fyEEQQAhAAwBC0EAKQOYCSEBQQApA5AJIQJBACkDiAkhA0EAKQOACSEEQRAhAAtBACAAOgCKigFBAEIANwOAigFBAEIANwP4iQFBAEIANwPwiQFBAEIANwPoiQFBAEIANwPgiQFBAEIANwPYiQFBAEIANwPQiQFBAEIANwPIiQFBAEIANwPAiQFBACABNwO4iQFBACACNwOwiQFBACADNwOoiQFBACAENwOgiQFBACABNwOYiQFBACACNwOQiQFBACADNwOIiQFBACAENwOAiQFBAEEAOgCQigFBAEEAOwGIigELBgAgABADCwYAIAAQBwsGAEGAiQELqwIBBH4CQAJAIAFBIEYNAEKrs4/8kaOz8NsAIQNC/6S5iMWR2oKbfyEEQvLmu+Ojp/2npX8hBULnzKfQ1tDrs7t/IQZBACEBDAELQQApA5gJIQNBACkDkAkhBEEAKQOICSEFQQApA4AJIQZBECEBC0EAIAE6AIqKAUEAQgA3A4CKAUEAQgA3A/iJAUEAQgA3A/CJAUEAQgA3A+iJAUEAQgA3A+CJAUEAQgA3A9iJAUEAQgA3A9CJAUEAQgA3A8iJAUEAQgA3A8CJAUEAIAM3A7iJAUEAIAQ3A7CJAUEAIAU3A6iJAUEAIAY3A6CJAUEAIAM3A5iJAUEAIAQ3A5CJAUEAIAU3A4iJAUEAIAY3A4CJAUEAQQA6AJCKAUEAQQA7AYiKASAAEAMgAhAHCwsLAQBBgAgLBHgHAAA=";
      var hash$h = "215d875f";
      var wasmJson$h = {
        name: name$h,
        data: data$h,
        hash: hash$h
      };
      const mutex$i = new Mutex();
      let wasmCache$i = null;
      function validateBits$2(bits) {
        if (!Number.isInteger(bits) || bits < 8 || bits % 8 !== 0) {
          return new Error("Invalid variant! Valid values: 8, 16, ...");
        }
        return null;
      }
      function blake3(data2, bits = 256, key = null) {
        if (validateBits$2(bits)) {
          return Promise.reject(validateBits$2(bits));
        }
        let keyBuffer = null;
        let initParam = 0;
        if (key !== null) {
          keyBuffer = getUInt8Buffer(key);
          if (keyBuffer.length !== 32) {
            return Promise.reject(new Error("Key length must be exactly 32 bytes"));
          }
          initParam = 32;
        }
        const hashLength = bits / 8;
        const digestParam = hashLength;
        if (wasmCache$i === null || wasmCache$i.hashLength !== hashLength) {
          return lockedCreate(mutex$i, wasmJson$h, hashLength).then((wasm) => {
            wasmCache$i = wasm;
            if (initParam === 32) {
              wasmCache$i.writeMemory(keyBuffer);
            }
            return wasmCache$i.calculate(data2, initParam, digestParam);
          });
        }
        try {
          if (initParam === 32) {
            wasmCache$i.writeMemory(keyBuffer);
          }
          const hash2 = wasmCache$i.calculate(data2, initParam, digestParam);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createBLAKE3(bits = 256, key = null) {
        if (validateBits$2(bits)) {
          return Promise.reject(validateBits$2(bits));
        }
        let keyBuffer = null;
        let initParam = 0;
        if (key !== null) {
          keyBuffer = getUInt8Buffer(key);
          if (keyBuffer.length !== 32) {
            return Promise.reject(new Error("Key length must be exactly 32 bytes"));
          }
          initParam = 32;
        }
        const outputSize = bits / 8;
        const digestParam = outputSize;
        return WASMInterface(wasmJson$h, outputSize).then((wasm) => {
          if (initParam === 32) {
            wasm.writeMemory(keyBuffer);
          }
          wasm.init(initParam);
          const obj = {
            init: initParam === 32 ? () => {
              wasm.writeMemory(keyBuffer);
              wasm.init(initParam);
              return obj;
            } : () => {
              wasm.init(initParam);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType, digestParam),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: outputSize
          };
          return obj;
        });
      }
      var name$g = "crc32";
      var data$g = "AGFzbQEAAAABEQRgAAF/YAF/AGAAAGACf38AAwgHAAEBAQIAAwUEAQECAgYOAn8BQZDJBQt/AEGACAsHcAgGbWVtb3J5AgAOSGFzaF9HZXRCdWZmZXIAAAlIYXNoX0luaXQAAgtIYXNoX1VwZGF0ZQADCkhhc2hfRmluYWwABA1IYXNoX0dldFN0YXRlAAUOSGFzaF9DYWxjdWxhdGUABgpTVEFURV9TSVpFAwEKkggHBQBBgAkLwwMBA39BgIkBIQFBACECA0AgAUEAQQBBAEEAQQBBAEEAQQAgAkEBcWsgAHEgAkEBdnMiA0EBcWsgAHEgA0EBdnMiA0EBcWsgAHEgA0EBdnMiA0EBcWsgAHEgA0EBdnMiA0EBcWsgAHEgA0EBdnMiA0EBcWsgAHEgA0EBdnMiA0EBcWsgAHEgA0EBdnMiA0EBcWsgAHEgA0EBdnM2AgAgAUEEaiEBIAJBAWoiAkGAAkcNAAtBACEAA0AgAEGEkQFqIABBhIkBaigCACICQf8BcUECdEGAiQFqKAIAIAJBCHZzIgI2AgAgAEGEmQFqIAJB/wFxQQJ0QYCJAWooAgAgAkEIdnMiAjYCACAAQYShAWogAkH/AXFBAnRBgIkBaigCACACQQh2cyICNgIAIABBhKkBaiACQf8BcUECdEGAiQFqKAIAIAJBCHZzIgI2AgAgAEGEsQFqIAJB/wFxQQJ0QYCJAWooAgAgAkEIdnMiAjYCACAAQYS5AWogAkH/AXFBAnRBgIkBaigCACACQQh2cyICNgIAIABBhMEBaiACQf8BcUECdEGAiQFqKAIAIAJBCHZzNgIAIABBBGoiAEH8B0cNAAsLJwACQEEAKAKAyQEgAEYNACAAEAFBACAANgKAyQELQQBBADYChMkBC4gDAQN/QQAoAoTJAUF/cyEBQYAJIQICQCAAQQhJDQBBgAkhAgNAIAJBBGooAgAiA0EOdkH8B3FBgJEBaigCACADQRZ2QfwHcUGAiQFqKAIAcyADQQZ2QfwHcUGAmQFqKAIAcyADQf8BcUECdEGAoQFqKAIAcyACKAIAIAFzIgFBFnZB/AdxQYCpAWooAgBzIAFBDnZB/AdxQYCxAWooAgBzIAFBBnZB/AdxQYC5AWooAgBzIAFB/wFxQQJ0QYDBAWooAgBzIQEgAkEIaiECIABBeGoiAEEHSw0ACwsCQCAARQ0AAkACQCAAQQFxDQAgACEDDAELIAFB/wFxIAItAABzQQJ0QYCJAWooAgAgAUEIdnMhASACQQFqIQIgAEF/aiEDCyAAQQFGDQADQCABQf8BcSACLQAAc0ECdEGAiQFqKAIAIAFBCHZzIgFB/wFxIAJBAWotAABzQQJ0QYCJAWooAgAgAUEIdnMhASACQQJqIQIgA0F+aiIDDQALC0EAIAFBf3M2AoTJAQsyAQF/QQBBACgChMkBIgBBGHQgAEGA/gNxQQh0ciAAQQh2QYD+A3EgAEEYdnJyNgKACQsGAEGEyQELWQACQEEAKAKAyQEgAUYNACABEAFBACABNgKAyQELQQBBADYChMkBIAAQA0EAQQAoAoTJASIBQRh0IAFBgP4DcUEIdHIgAUEIdkGA/gNxIAFBGHZycjYCgAkLCwsBAEGACAsEBAAAAA==";
      var hash$g = "d2eba587";
      var wasmJson$g = {
        name: name$g,
        data: data$g,
        hash: hash$g
      };
      const mutex$h = new Mutex();
      let wasmCache$h = null;
      function validatePoly(poly) {
        if (!Number.isInteger(poly) || poly < 0 || poly > 4294967295) {
          return new Error("Polynomial must be a valid 32-bit long unsigned integer");
        }
        return null;
      }
      function crc32(data2, polynomial = 3988292384) {
        if (validatePoly(polynomial)) {
          return Promise.reject(validatePoly(polynomial));
        }
        if (wasmCache$h === null) {
          return lockedCreate(mutex$h, wasmJson$g, 4).then((wasm) => {
            wasmCache$h = wasm;
            return wasmCache$h.calculate(data2, polynomial);
          });
        }
        try {
          const hash2 = wasmCache$h.calculate(data2, polynomial);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createCRC32(polynomial = 3988292384) {
        if (validatePoly(polynomial)) {
          return Promise.reject(validatePoly(polynomial));
        }
        return WASMInterface(wasmJson$g, 4).then((wasm) => {
          wasm.init(polynomial);
          const obj = {
            init: () => {
              wasm.init(polynomial);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 4,
            digestSize: 4
          };
          return obj;
        });
      }
      var name$f = "crc64";
      var data$f = "AGFzbQEAAAABDANgAAF/YAAAYAF/AAMHBgABAgEAAQUEAQECAgYOAn8BQZCJBgt/AEGACAsHcAgGbWVtb3J5AgAOSGFzaF9HZXRCdWZmZXIAAAlIYXNoX0luaXQAAQtIYXNoX1VwZGF0ZQACCkhhc2hfRmluYWwAAw1IYXNoX0dldFN0YXRlAAQOSGFzaF9DYWxjdWxhdGUABQpTVEFURV9TSVpFAwEKgwgGBQBBgAkL9QMDAX4BfwJ+AkBBACkDgIkCQQApA4AJIgBRDQBBgIkBIQFCACECA0AgAUIAQgBCAEIAQgBCAEIAQgAgAkIBg30gAIMgAkIBiIUiA0IBg30gAIMgA0IBiIUiA0IBg30gAIMgA0IBiIUiA0IBg30gAIMgA0IBiIUiA0IBg30gAIMgA0IBiIUiA0IBg30gAIMgA0IBiIUiA0IBg30gAIMgA0IBiIUiA0IBg30gAIMgA0IBiIU3AwAgAUEIaiEBIAJCAXwiAkKAAlINAAtBACEBA0AgAUGImQFqIAFBiIkBaikDACICp0H/AXFBA3RBgIkBaikDACACQgiIhSICNwMAIAFBiKkBaiACp0H/AXFBA3RBgIkBaikDACACQgiIhSICNwMAIAFBiLkBaiACp0H/AXFBA3RBgIkBaikDACACQgiIhSICNwMAIAFBiMkBaiACp0H/AXFBA3RBgIkBaikDACACQgiIhSICNwMAIAFBiNkBaiACp0H/AXFBA3RBgIkBaikDACACQgiIhSICNwMAIAFBiOkBaiACp0H/AXFBA3RBgIkBaikDACACQgiIhSICNwMAIAFBiPkBaiACp0H/AXFBA3RBgIkBaikDACACQgiIhTcDACABQQhqIgFB+A9HDQALQQAgADcDgIkCC0EAQgA3A4iJAguUAwIBfgJ/QQApA4iJAkJ/hSEBQYAJIQICQCAAQQhJDQBBgAkhAgNAIAIpAwAgAYUiAUIwiKdB/wFxQQN0QYCZAWopAwAgAUI4iKdBA3RBgIkBaikDAIUgAUIoiKdB/wFxQQN0QYCpAWopAwCFIAFCIIinQf8BcUEDdEGAuQFqKQMAhSABpyIDQRV2QfgPcUGAyQFqKQMAhSADQQ12QfgPcUGA2QFqKQMAhSADQQV2QfgPcUGA6QFqKQMAhSADQf8BcUEDdEGA+QFqKQMAhSEBIAJBCGohAiAAQXhqIgBBB0sNAAsLAkAgAEUNAAJAAkAgAEEBcQ0AIAAhAwwBCyABQv8BgyACMQAAhadBA3RBgIkBaikDACABQgiIhSEBIAJBAWohAiAAQX9qIQMLIABBAUYNAANAIAFC/wGDIAIxAACFp0EDdEGAiQFqKQMAIAFCCIiFIgFC/wGDIAJBAWoxAACFp0EDdEGAiQFqKQMAIAFCCIiFIQEgAkECaiECIANBfmoiAw0ACwtBACABQn+FNwOIiQILZAEBfkEAQQApA4iJAiIAQjiGIABCgP4Dg0IohoQgAEKAgPwHg0IYhiAAQoCAgPgPg0IIhoSEIABCCIhCgICA+A+DIABCGIhCgID8B4OEIABCKIhCgP4DgyAAQjiIhISENwOACQsGAEGIiQILAgALCwsBAEGACAsECAAAAA==";
      var hash$f = "c5ac6c16";
      var wasmJson$f = {
        name: name$f,
        data: data$f,
        hash: hash$f
      };
      const mutex$g = new Mutex();
      let wasmCache$g = null;
      const polyBuffer = new Uint8Array(8);
      function parsePoly(poly) {
        const errText = "Polynomial must be provided as a 16 char long hex string";
        if (typeof poly !== "string" || poly.length !== 16) {
          return { hi: 0, lo: 0, err: new Error(errText) };
        }
        const hi = Number(`0x${poly.slice(0, 8)}`);
        const lo = Number(`0x${poly.slice(8)}`);
        if (Number.isNaN(hi) || Number.isNaN(lo)) {
          return { hi, lo, err: new Error(errText) };
        }
        return { hi, lo, err: null };
      }
      function writePoly(arr, lo, hi) {
        const buffer = new DataView(arr);
        buffer.setUint32(0, lo, true);
        buffer.setUint32(4, hi, true);
      }
      function crc64(data2, polynomial = "c96c5795d7870f42") {
        const { hi, lo, err } = parsePoly(polynomial);
        if (err !== null) {
          return Promise.reject(err);
        }
        if (wasmCache$g === null) {
          return lockedCreate(mutex$g, wasmJson$f, 8).then((wasm) => {
            wasmCache$g = wasm;
            writePoly(polyBuffer.buffer, lo, hi);
            wasmCache$g.writeMemory(polyBuffer);
            return wasmCache$g.calculate(data2);
          });
        }
        try {
          writePoly(polyBuffer.buffer, lo, hi);
          wasmCache$g.writeMemory(polyBuffer);
          const hash2 = wasmCache$g.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err2) {
          return Promise.reject(err2);
        }
      }
      function createCRC64(polynomial = "c96c5795d7870f42") {
        const { hi, lo, err } = parsePoly(polynomial);
        if (err !== null) {
          return Promise.reject(err);
        }
        return WASMInterface(wasmJson$f, 8).then((wasm) => {
          const instanceBuffer = new Uint8Array(8);
          writePoly(instanceBuffer.buffer, lo, hi);
          wasm.writeMemory(instanceBuffer);
          wasm.init();
          const obj = {
            init: () => {
              wasm.writeMemory(instanceBuffer);
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 8,
            digestSize: 8
          };
          return obj;
        });
      }
      var name$e = "md4";
      var data$e = "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";
      var hash$e = "bd8ce7c7";
      var wasmJson$e = {
        name: name$e,
        data: data$e,
        hash: hash$e
      };
      const mutex$f = new Mutex();
      let wasmCache$f = null;
      function md4(data2) {
        if (wasmCache$f === null) {
          return lockedCreate(mutex$f, wasmJson$e, 16).then((wasm) => {
            wasmCache$f = wasm;
            return wasmCache$f.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache$f.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createMD4() {
        return WASMInterface(wasmJson$e, 16).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 16
          };
          return obj;
        });
      }
      var name$d = "md5";
      var data$d = "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";
      var hash$d = "e6508e4b";
      var wasmJson$d = {
        name: name$d,
        data: data$d,
        hash: hash$d
      };
      const mutex$e = new Mutex();
      let wasmCache$e = null;
      function md5(data2) {
        if (wasmCache$e === null) {
          return lockedCreate(mutex$e, wasmJson$d, 16).then((wasm) => {
            wasmCache$e = wasm;
            return wasmCache$e.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache$e.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createMD5() {
        return WASMInterface(wasmJson$d, 16).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 16
          };
          return obj;
        });
      }
      var name$c = "sha1";
      var data$c = "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";
      var hash$c = "6b530c24";
      var wasmJson$c = {
        name: name$c,
        data: data$c,
        hash: hash$c
      };
      const mutex$d = new Mutex();
      let wasmCache$d = null;
      function sha1(data2) {
        if (wasmCache$d === null) {
          return lockedCreate(mutex$d, wasmJson$c, 20).then((wasm) => {
            wasmCache$d = wasm;
            return wasmCache$d.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache$d.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSHA1() {
        return WASMInterface(wasmJson$c, 20).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 20
          };
          return obj;
        });
      }
      var name$b = "sha3";
      var data$b = "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";
      var hash$b = "fb24e536";
      var wasmJson$b = {
        name: name$b,
        data: data$b,
        hash: hash$b
      };
      const mutex$c = new Mutex();
      let wasmCache$c = null;
      function validateBits$1(bits) {
        if (![224, 256, 384, 512].includes(bits)) {
          return new Error("Invalid variant! Valid values: 224, 256, 384, 512");
        }
        return null;
      }
      function sha3(data2, bits = 512) {
        if (validateBits$1(bits)) {
          return Promise.reject(validateBits$1(bits));
        }
        const hashLength = bits / 8;
        if (wasmCache$c === null || wasmCache$c.hashLength !== hashLength) {
          return lockedCreate(mutex$c, wasmJson$b, hashLength).then((wasm) => {
            wasmCache$c = wasm;
            return wasmCache$c.calculate(data2, bits, 6);
          });
        }
        try {
          const hash2 = wasmCache$c.calculate(data2, bits, 6);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSHA3(bits = 512) {
        if (validateBits$1(bits)) {
          return Promise.reject(validateBits$1(bits));
        }
        const outputSize = bits / 8;
        return WASMInterface(wasmJson$b, outputSize).then((wasm) => {
          wasm.init(bits);
          const obj = {
            init: () => {
              wasm.init(bits);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType, 6),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 200 - 2 * outputSize,
            digestSize: outputSize
          };
          return obj;
        });
      }
      const mutex$b = new Mutex();
      let wasmCache$b = null;
      function validateBits(bits) {
        if (![224, 256, 384, 512].includes(bits)) {
          return new Error("Invalid variant! Valid values: 224, 256, 384, 512");
        }
        return null;
      }
      function keccak(data2, bits = 512) {
        if (validateBits(bits)) {
          return Promise.reject(validateBits(bits));
        }
        const hashLength = bits / 8;
        if (wasmCache$b === null || wasmCache$b.hashLength !== hashLength) {
          return lockedCreate(mutex$b, wasmJson$b, hashLength).then((wasm) => {
            wasmCache$b = wasm;
            return wasmCache$b.calculate(data2, bits, 1);
          });
        }
        try {
          const hash2 = wasmCache$b.calculate(data2, bits, 1);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createKeccak(bits = 512) {
        if (validateBits(bits)) {
          return Promise.reject(validateBits(bits));
        }
        const outputSize = bits / 8;
        return WASMInterface(wasmJson$b, outputSize).then((wasm) => {
          wasm.init(bits);
          const obj = {
            init: () => {
              wasm.init(bits);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType, 1),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 200 - 2 * outputSize,
            digestSize: outputSize
          };
          return obj;
        });
      }
      var name$a = "sha256";
      var data$a = "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c2pBx6KerX1qIhkgASADcyACcSABIANxcyABQR53IAFBE3dzIAFBCndzaiAaaiICaiIJIBMgEnNxIBJzaiAJQRp3IAlBFXdzIAlBB3dzakHRxqk2aiIaIAIgAXMgA3EgAiABcXMgAkEedyACQRN3cyACQQp3c2ogGGoiA2oiESAJIBNzcSATc2ogEUEadyARQRV3cyARQQd3c2pB59KkoQFqIhggAyACcyABcSADIAJxcyADQR53IANBE3dzIANBCndzaiAUaiIBaiISIBEgCXNxIAlzaiASQRp3IBJBFXdzIBJBB3dzakGFldy9AmoiFCABIANzIAJxIAEgA3FzIAFBHncgAUETd3MgAUEKd3NqIBdqIgJqIhMgI2ogJiASaiAiIBFqICUgCWogEyASIBFzcSARc2ogE0EadyATQRV3cyATQQd3c2pBuMLs8AJqIhcgAiABcyADcSACIAFxcyACQR53IAJBE3dzIAJBCndzaiAZaiIDaiIJIBMgEnNxIBJzaiAJQRp3IAlBFXdzIAlBB3dzakH827HpBGoiGSADIAJzIAFxIAMgAnFzIANBHncgA0ETd3MgA0EKd3NqIBpqIgFqIhEgCSATc3EgE3NqIBFBGncgEUEVd3MgEUEHd3NqQZOa4JkFaiIaIAEgA3MgAnEgASADcXMgAUEedyABQRN3cyABQQp3c2ogGGoiAmoiEiARIAlzcSAJc2ogEkEadyASQRV3cyASQQd3c2pB1OapqAZqIhggAiABcyADcSACIAFxcyACQR53IAJBE3dzIAJBCndzaiAUaiIDaiITaiAoIBJqICQgEWogJyAJaiATIBIgEXNxIBFzaiATQRp3IBNBFXdzIBNBB3dzakG7laizB2oiFCADIAJzIAFxIAMgAnFzIANBHncgA0ETd3MgA0EKd3NqIBdqIgFqIgkgEyASc3EgEnNqIAlBGncgCUEVd3MgCUEHd3NqQa6Si454aiIXIAEgA3MgAnEgASADcXMgAUEedyABQRN3cyABQQp3c2ogGWoiAmoiESAJIBNzcSATc2ogEUEadyARQRV3cyARQQd3c2pBhdnIk3lqIhkgAiABcyADcSACIAFxcyACQR53IAJBE3dzIAJBCndzaiAaaiIDaiISIBEgCXNxIAlzaiASQRp3IBJBFXdzIBJBB3dzakGh0f+VemoiGiADIAJz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";
      var hash$a = "8c18dd94";
      var wasmJson$a = {
        name: name$a,
        data: data$a,
        hash: hash$a
      };
      const mutex$a = new Mutex();
      let wasmCache$a = null;
      function sha224(data2) {
        if (wasmCache$a === null) {
          return lockedCreate(mutex$a, wasmJson$a, 28).then((wasm) => {
            wasmCache$a = wasm;
            return wasmCache$a.calculate(data2, 224);
          });
        }
        try {
          const hash2 = wasmCache$a.calculate(data2, 224);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSHA224() {
        return WASMInterface(wasmJson$a, 28).then((wasm) => {
          wasm.init(224);
          const obj = {
            init: () => {
              wasm.init(224);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 28
          };
          return obj;
        });
      }
      const mutex$9 = new Mutex();
      let wasmCache$9 = null;
      function sha256(data2) {
        if (wasmCache$9 === null) {
          return lockedCreate(mutex$9, wasmJson$a, 32).then((wasm) => {
            wasmCache$9 = wasm;
            return wasmCache$9.calculate(data2, 256);
          });
        }
        try {
          const hash2 = wasmCache$9.calculate(data2, 256);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSHA256() {
        return WASMInterface(wasmJson$a, 32).then((wasm) => {
          wasm.init(256);
          const obj = {
            init: () => {
              wasm.init(256);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 32
          };
          return obj;
        });
      }
      var name$9 = "sha512";
      var data$9 = "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";
      var hash$9 = "f2e40eb1";
      var wasmJson$9 = {
        name: name$9,
        data: data$9,
        hash: hash$9
      };
      const mutex$8 = new Mutex();
      let wasmCache$8 = null;
      function sha384(data2) {
        if (wasmCache$8 === null) {
          return lockedCreate(mutex$8, wasmJson$9, 48).then((wasm) => {
            wasmCache$8 = wasm;
            return wasmCache$8.calculate(data2, 384);
          });
        }
        try {
          const hash2 = wasmCache$8.calculate(data2, 384);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSHA384() {
        return WASMInterface(wasmJson$9, 48).then((wasm) => {
          wasm.init(384);
          const obj = {
            init: () => {
              wasm.init(384);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 128,
            digestSize: 48
          };
          return obj;
        });
      }
      const mutex$7 = new Mutex();
      let wasmCache$7 = null;
      function sha512(data2) {
        if (wasmCache$7 === null) {
          return lockedCreate(mutex$7, wasmJson$9, 64).then((wasm) => {
            wasmCache$7 = wasm;
            return wasmCache$7.calculate(data2, 512);
          });
        }
        try {
          const hash2 = wasmCache$7.calculate(data2, 512);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSHA512() {
        return WASMInterface(wasmJson$9, 64).then((wasm) => {
          wasm.init(512);
          const obj = {
            init: () => {
              wasm.init(512);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 128,
            digestSize: 64
          };
          return obj;
        });
      }
      var name$8 = "xxhash32";
      var data$8 = "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";
      var hash$8 = "4bb12485";
      var wasmJson$8 = {
        name: name$8,
        data: data$8,
        hash: hash$8
      };
      const mutex$6 = new Mutex();
      let wasmCache$6 = null;
      function validateSeed$3(seed) {
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
          return new Error("Seed must be a valid 32-bit long unsigned integer.");
        }
        return null;
      }
      function xxhash32(data2, seed = 0) {
        if (validateSeed$3(seed)) {
          return Promise.reject(validateSeed$3(seed));
        }
        if (wasmCache$6 === null) {
          return lockedCreate(mutex$6, wasmJson$8, 4).then((wasm) => {
            wasmCache$6 = wasm;
            return wasmCache$6.calculate(data2, seed);
          });
        }
        try {
          const hash2 = wasmCache$6.calculate(data2, seed);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createXXHash32(seed = 0) {
        if (validateSeed$3(seed)) {
          return Promise.reject(validateSeed$3(seed));
        }
        return WASMInterface(wasmJson$8, 4).then((wasm) => {
          wasm.init(seed);
          const obj = {
            init: () => {
              wasm.init(seed);
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 16,
            digestSize: 4
          };
          return obj;
        });
      }
      var name$7 = "xxhash64";
      var data$7 = "AGFzbQEAAAABDANgAAF/YAAAYAF/AAMHBgABAgEAAQUEAQECAgYOAn8BQdCJBQt/AEGACAsHcAgGbWVtb3J5AgAOSGFzaF9HZXRCdWZmZXIAAAlIYXNoX0luaXQAAQtIYXNoX1VwZGF0ZQACCkhhc2hfRmluYWwAAw1IYXNoX0dldFN0YXRlAAQOSGFzaF9DYWxjdWxhdGUABQpTVEFURV9TSVpFAwEKmxEGBQBBgAkLYwEBfkEAQgA3A8iJAUEAQQApA4AJIgA3A5CJAUEAIABC+erQ0OfJoeThAHw3A5iJAUEAIABCz9bTvtLHq9lCfDcDiIkBQQAgAELW64Lu6v2J9eAAfDcDgIkBQQBBADYCwIkBC70IAwV/BH4CfwJAIABFDQBBAEEAKQPIiQEgAK18NwPIiQECQEEAKALAiQEiASAAakEfSw0AAkACQCAAQQNxIgINAEGACSEDIAAhAQwBCyAAQXxxIQFBgAkhAwNAQQBBACgCwIkBIgRBAWo2AsCJASAEQaCJAWogAy0AADoAACADQQFqIQMgAkF/aiICDQALCyAAQQRJDQEDQEEAQQAoAsCJASICQQFqNgLAiQEgAkGgiQFqIAMtAAA6AAAgA0EBai0AACECQQBBACgCwIkBIgRBAWo2AsCJASAEQaCJAWogAjoAACADQQJqLQAAIQJBAEEAKALAiQEiBEEBajYCwIkBIARBoIkBaiACOgAAIANBA2otAAAhAkEAQQAoAsCJASIEQQFqNgLAiQEgBEGgiQFqIAI6AAAgA0EEaiEDIAFBfGoiAQ0ADAILCyAAQeAIaiEFAkACQCABDQBBACkDmIkBIQZBACkDkIkBIQdBACkDiIkBIQhBACkDgIkBIQlBgAkhAwwBC0GACSEDAkAgAUEfSw0AQYAJIQMCQAJAQQAgAWtBA3EiBA0AIAEhAgwBCyABIQIDQCACQaCJAWogAy0AADoAACACQQFqIQIgA0EBaiEDIARBf2oiBA0ACwsgAUFjakEDSQ0AQSAgAmshCkEAIQQDQCACIARqIgFBoIkBaiADIARqIgstAAA6AAAgAUGhiQFqIAtBAWotAAA6AAAgAUGiiQFqIAtBAmotAAA6AAAgAUGjiQFqIAtBA2otAAA6AAAgCiAEQQRqIgRHDQALIAMgBGohAwtBAEEAKQOgiQFCz9bTvtLHq9lCfkEAKQOAiQF8Qh+JQoeVr6+Ytt6bnn9+Igk3A4CJAUEAQQApA6iJAULP1tO+0ser2UJ+QQApA4iJAXxCH4lCh5Wvr5i23puef34iCDcDiIkBQQBBACkDsIkBQs/W077Sx6vZQn5BACkDkIkBfEIfiUKHla+vmLbem55/fiIHNwOQiQFBAEEAKQO4iQFCz9bTvtLHq9lCfkEAKQOYiQF8Qh+JQoeVr6+Ytt6bnn9+IgY3A5iJAQsgAEGACWohAgJAIAMgBUsNAANAIAMpAwBCz9bTvtLHq9lCfiAJfEIfiUKHla+vmLbem55/fiEJIANBGGopAwBCz9bTvtLHq9lCfiAGfEIfiUKHla+vmLbem55/fiEGIANBEGopAwBCz9bTvtLHq9lCfiAHfEIfiUKHla+vmLbem55/fiEHIANBCGopAwBCz9bTvtLHq9lCfiAIfEIfiUKHla+vmLbem55/fiEIIANBIGoiAyAFTQ0ACwtBACAGNwOYiQFBACAHNwOQiQFBACAINwOIiQFBACAJNwOAiQFBACACIANrNgLAiQEgAiADRg0AQQAhAgNAIAJBoIkBaiADIAJqLQAAOgAAIAJBAWoiAkEAKALAiQFJDQALCwvlBwIFfgV/AkACQEEAKQPIiQEiAEIgVA0AQQApA4iJASIBQgeJQQApA4CJASICQgGJfEEAKQOQiQEiA0IMiXxBACkDmIkBIgRCEol8IAJCz9bTvtLHq9lCfkIfiUKHla+vmLbem55/foVCh5Wvr5i23puef35C49zKlfzO8vWFf3wgAULP1tO+0ser2UJ+Qh+JQoeVr6+Ytt6bnn9+hUKHla+vmLbem55/fkLj3MqV/M7y9YV/fCADQs/W077Sx6vZQn5CH4lCh5Wvr5i23puef36FQoeVr6+Ytt6bnn9+QuPcypX8zvL1hX98IARCz9bTvtLHq9lCfkIfiUKHla+vmLbem55/foVCh5Wvr5i23puef35C49zKlfzO8vWFf3whAQwBC0EAKQOQiQFCxc/ZsvHluuonfCEBCyABIAB8IQBBoIkBIQVBqIkBIQYCQEEAKALAiQEiB0GgiQFqIghBqIkBSQ0AQaCJASEFAkAgB0F4aiIJQQhxDQBBACkDoIkBQs/W077Sx6vZQn5CH4lCh5Wvr5i23puef34gAIVCG4lCh5Wvr5i23puef35C49zKlfzO8vWFf3whAEGwiQEhBkGoiQEhBSAJQQhJDQELA0AgBikDAELP1tO+0ser2UJ+Qh+JQoeVr6+Ytt6bnn9+IAUpAwBCz9bTvtLHq9lCfkIfiUKHla+vmLbem55/fiAAhUIbiUKHla+vmLbem55/fkLj3MqV/M7y9YV/fIVCG4lCh5Wvr5i23puef35C49zKlfzO8vWFf3whACAGQQhqIQUgBkEQaiIGIAhNDQALIAZBeGohBQsCQAJAIAVBBGoiCSAITQ0AIAUhCQwBCyAFNQIAQoeVr6+Ytt6bnn9+IACFQheJQs/W077Sx6vZQn5C+fPd8Zn2masWfCEACwJAIAkgCEYNACAHQZ+JAWohBQJAAkAgByAJa0EBcQ0AIAkhBgwBCyAJQQFqIQYgCTEAAELFz9my8eW66id+IACFQguJQoeVr6+Ytt6bnn9+IQALIAUgCUYNAANAIAZBAWoxAABCxc/ZsvHluuonfiAGMQAAQsXP2bLx5brqJ34gAIVCC4lCh5Wvr5i23puef36FQguJQoeVr6+Ytt6bnn9+IQAgBkECaiIGIAhHDQALC0EAIABCIYggAIVCz9bTvtLHq9lCfiIAQh2IIACFQvnz3fGZ9pmrFn4iAEIgiCAAhSIBQjiGIAFCgP4Dg0IohoQgAUKAgPwHg0IYhiABQoCAgPgPg0IIhoSEIABCCIhCgICA+A+DIABCGIhCgID8B4OEIABCKIhCgP4DgyAAQjiIhISENwOACQsGAEGAiQELAgALCwsBAEGACAsEUAAAAA==";
      var hash$7 = "177fbfa3";
      var wasmJson$7 = {
        name: name$7,
        data: data$7,
        hash: hash$7
      };
      const mutex$5 = new Mutex();
      let wasmCache$5 = null;
      const seedBuffer$2 = new Uint8Array(8);
      function validateSeed$2(seed) {
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
          return new Error("Seed must be given as two valid 32-bit long unsigned integers (lo + high).");
        }
        return null;
      }
      function writeSeed$2(arr, low, high) {
        const buffer = new DataView(arr);
        buffer.setUint32(0, low, true);
        buffer.setUint32(4, high, true);
      }
      function xxhash64(data2, seedLow = 0, seedHigh = 0) {
        if (validateSeed$2(seedLow)) {
          return Promise.reject(validateSeed$2(seedLow));
        }
        if (validateSeed$2(seedHigh)) {
          return Promise.reject(validateSeed$2(seedHigh));
        }
        if (wasmCache$5 === null) {
          return lockedCreate(mutex$5, wasmJson$7, 8).then((wasm) => {
            wasmCache$5 = wasm;
            writeSeed$2(seedBuffer$2.buffer, seedLow, seedHigh);
            wasmCache$5.writeMemory(seedBuffer$2);
            return wasmCache$5.calculate(data2);
          });
        }
        try {
          writeSeed$2(seedBuffer$2.buffer, seedLow, seedHigh);
          wasmCache$5.writeMemory(seedBuffer$2);
          const hash2 = wasmCache$5.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createXXHash64(seedLow = 0, seedHigh = 0) {
        if (validateSeed$2(seedLow)) {
          return Promise.reject(validateSeed$2(seedLow));
        }
        if (validateSeed$2(seedHigh)) {
          return Promise.reject(validateSeed$2(seedHigh));
        }
        return WASMInterface(wasmJson$7, 8).then((wasm) => {
          const instanceBuffer = new Uint8Array(8);
          writeSeed$2(instanceBuffer.buffer, seedLow, seedHigh);
          wasm.writeMemory(instanceBuffer);
          wasm.init();
          const obj = {
            init: () => {
              wasm.writeMemory(instanceBuffer);
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 32,
            digestSize: 8
          };
          return obj;
        });
      }
      var name$6 = "xxhash3";
      var data$6 = "AGFzbQEAAAABNAhgAAF/YAR/f39/AGAHf39/f39/fwBgBH9+fn4BfmAEf39/fgF+YAN/f34BfmAAAGABfwADDg0AAQIDBAUFBQYHBgAGBQQBAQICBg4CfwFBwI4FC38AQcAJCwdwCAZtZW1vcnkCAA5IYXNoX0dldEJ1ZmZlcgAACUhhc2hfSW5pdAAIC0hhc2hfVXBkYXRlAAkKSGFzaF9GaW5hbAAKDUhhc2hfR2V0U3RhdGUACw5IYXNoX0NhbGN1bGF0ZQAMClNUQVRFX1NJWkUDAQr6QQ0FAEGACgvkAwMPfgF/AX4CQCADRQ0AIAApAzAhBCAAKQM4IQUgACkDICEGIAApAyghByAAKQMQIQggACkDGCEJIAApAwAhCiAAKQMIIQsDQCAFIAFBMGopAwAiDHwgAkE4aikDACABQThqKQMAIg2FIgVCIIggBUL/////D4N+fCEFIAcgAUEgaikDACIOfCACQShqKQMAIAFBKGopAwAiD4UiB0IgiCAHQv////8Pg358IQcgCSABQRBqKQMAIhB8IAJBGGopAwAgAUEYaikDACIRhSIJQiCIIAlC/////w+DfnwhCSALIAEpAwAiEnwgAkEIaiITKQMAIAFBCGopAwAiFIUiC0IgiCALQv////8Pg358IQsgAkEwaikDACAMhSIMQiCIIAxC/////w+DfiAEfCANfCEEIAJBIGopAwAgDoUiDEIgiCAMQv////8Pg34gBnwgD3whBiACQRBqKQMAIBCFIgxCIIggDEL/////D4N+IAh8IBF8IQggAikDACAShSIMQiCIIAxC/////w+DfiAKfCAUfCEKIAFBwABqIQEgEyECIANBf2oiAw0ACyAAIAk3AxggACAKNwMAIAAgCzcDCCAAIAc3AyggACAINwMQIAAgBTcDOCAAIAY3AyAgACAENwMwCwveAgIBfwF+AkAgBCACIAEoAgAiB2siAkkNACAAIAMgBSAHQQN0aiACEAEgACAFIAZqIgcpAwAgACkDACIIQi+IhSAIhUKx893xCX43AwAgACAHKQMIIAApAwgiCEIviIUgCIVCsfPd8Ql+NwMIIAAgBykDECAAKQMQIghCL4iFIAiFQrHz3fEJfjcDECAAIAcpAxggACkDGCIIQi+IhSAIhUKx893xCX43AxggACAHKQMgIAApAyAiCEIviIUgCIVCsfPd8Ql+NwMgIAAgBykDKCAAKQMoIghCL4iFIAiFQrHz3fEJfjcDKCAAIAcpAzAgACkDMCIIQi+IhSAIhUKx893xCX43AzAgACAHKQM4IAApAzgiCEIviIUgCIVCsfPd8Ql+NwM4IAAgAyACQQZ0aiAFIAQgAmsiBxABIAEgBzYCAA8LIAAgAyAFIAdBA3RqIAQQASABIAcgBGo2AgALhQEBAX8gAiABhSADpyIEQRh0IARBgP4DcUEIdHIgBEEIdkGA/gNxIARBGHZycq1CIIYgA4V9QQA1AoCMAUIghiAAQfyLAWo1AgCEhSIDQjGJIANCGImFIAOFQqW+4/TRjIfZn39+IgNCI4ggAK18IAOFQqW+4/TRjIfZn39+IgNCHIggA4ULZwAgAiABc60gA3wiA0IhiEEALQCAjAFBEHQgAEEIdHIgAEEBdkGAjAFqLQAAQRh0ciAAQf+LAWotAAByrYUgA4VCz9bTvtLHq9lCfiIDQh2IIAOFQvnz3fGZ9pmrFn4iA0IgiCADhQuJAwEEfgJAIABBCUkNAEEAKQOAjAEgASkDICABKQMYhSACfIUiA0I4hiADQoD+A4NCKIaEIANCgID8B4NCGIYgA0KAgID4D4NCCIaEhCADQgiIQoCAgPgPgyADQhiIQoCA/AeDhCADQiiIQoD+A4MgA0I4iISEhCAArXwgAEH4iwFqKQMAIAEpAzAgASkDKIUgAn2FIgJ8IAJC/////w+DIgQgA0IgiCIFfiIGQv////8PgyACQiCIIgIgA0L/////D4MiA358IAQgA34iA0IgiHwiBEIghiADQv////8Pg4QgBkIgiCACIAV+fCAEQiCIfIV8IgNCJYggA4VC+fPd8ZnymasWfiIDQiCIIAOFDwsCQCAAQQRJDQAgACABQQhqKQMAIAFBEGopAwAgAhADDwsCQCAARQ0AIAAgASgCACABQQRqKAIAIAIQBA8LIAEpAzggASkDQIUgAoUiA0IhiCADhULP1tO+0ser2UJ+IgNCHYggA4VC+fPd8Zn2masWfiIDQiCIIAOFC94IAQZ+IACtQoeVr6+Ytt6bnn9+IQMCQCAAQSFJDQACQCAAQcEASQ0AAkAgAEHhAEkNACABKQNoIAJ9QQApA7iMAYUiBEL/////D4MiBSABKQNgIAJ8QQApA7CMAYUiBkIgiCIHfiIIQv////8PgyAEQiCIIgQgBkL/////D4MiBn58IAUgBn4iBUIgiHwiBkIghiAFQv////8Pg4QgCEIgiCAEIAd+fCAGQiCIfIUgA3wgASkDeCACfSAAQciLAWopAwCFIgNC/////w+DIgQgASkDcCACfCAAQcCLAWopAwCFIgVCIIgiBn4iB0L/////D4MgA0IgiCIDIAVC/////w+DIgV+fCAEIAV+IgRCIIh8IgVCIIYgBEL/////D4OEIAdCIIggAyAGfnwgBUIgiHyFfCEDCyABKQNIIAJ9QQApA6iMAYUiBEL/////D4MiBSABKQNAIAJ8QQApA6CMAYUiBkIgiCIHfiIIQv////8PgyAEQiCIIgQgBkL/////D4MiBn58IAUgBn4iBUIgiHwiBkIghiAFQv////8Pg4QgCEIgiCAEIAd+fCAGQiCIfIUgA3wgASkDWCACfSAAQdiLAWopAwCFIgNC/////w+DIgQgASkDUCACfCAAQdCLAWopAwCFIgVCIIgiBn4iB0L/////D4MgA0IgiCIDIAVC/////w+DIgV+fCAEIAV+IgRCIIh8IgVCIIYgBEL/////D4OEIAdCIIggAyAGfnwgBUIgiHyFfCEDCyABKQMoIAJ9QQApA5iMAYUiBEL/////D4MiBSABKQMgIAJ8QQApA5CMAYUiBkIgiCIHfiIIQv////8PgyAEQiCIIgQgBkL/////D4MiBn58IAUgBn4iBUIgiHwiBkIghiAFQv////8Pg4QgCEIgiCAEIAd+fCAGQiCIfIUgA3wgASkDOCACfSAAQeiLAWopAwCFIgNC/////w+DIgQgASkDMCACfCAAQeCLAWopAwCFIgVCIIgiBn4iB0L/////D4MgA0IgiCIDIAVC/////w+DIgV+fCAEIAV+IgRCIIh8IgVCIIYgBEL/////D4OEIAdCIIggAyAGfnwgBUIgiHyFfCEDCyABKQMIIAJ9QQApA4iMAYUiBEL/////D4MiBSABKQMAIAJ8QQApA4CMAYUiBkIgiCIHfiIIQv////8PgyAEQiCIIgQgBkL/////D4MiBn58IAUgBn4iBUIgiHwiBkIghiAFQv////8Pg4QgCEIgiCAEIAd+fCAGQiCIfIUgA3wgASkDGCACfSAAQfiLAWopAwCFIgNC/////w+DIgQgASkDECACfCAAQfCLAWopAwCFIgJCIIgiBX4iBkL/////D4MgA0IgiCIDIAJC/////w+DIgJ+fCAEIAJ+IgJCIIh8IgRCIIYgAkL/////D4OEIAZCIIggAyAFfnwgBEIgiHyFfCICQiWIIAKFQvnz3fGZ8pmrFn4iAkIgiCAChQv8CgQBfwV+An8BfkEAIQMgASkDeCACfUEAKQP4jAGFIgRC/////w+DIgUgASkDcCACfEEAKQPwjAGFIgZCIIgiB34iCEL/////D4MgBEIgiCIEIAZC/////w+DIgZ+fCAFIAZ+IgVCIIh8IgZCIIYgBUL/////D4OEIAhCIIggBCAHfnwgBkIgiHyFIAEpA2ggAn1BACkD6IwBhSIEQv////8PgyIFIAEpA2AgAnxBACkD4IwBhSIGQiCIIgd+IghC/////w+DIARCIIgiBCAGQv////8PgyIGfnwgBSAGfiIFQiCIfCIGQiCGIAVC/////w+DhCAIQiCIIAQgB358IAZCIIh8hSABKQNYIAJ9QQApA9iMAYUiBEL/////D4MiBSABKQNQIAJ8QQApA9CMAYUiBkIgiCIHfiIIQv////8PgyAEQiCIIgQgBkL/////D4MiBn58IAUgBn4iBUIgiHwiBkIghiAFQv////8Pg4QgCEIgiCAEIAd+fCAGQiCIfIUgASkDSCACfUEAKQPIjAGFIgRC/////w+DIgUgASkDQCACfEEAKQPAjAGFIgZCIIgiB34iCEL/////D4MgBEIgiCIEIAZC/////w+DIgZ+fCAFIAZ+IgVCIIh8IgZCIIYgBUL/////D4OEIAhCIIggBCAHfnwgBkIgiHyFIAEpAzggAn1BACkDuIwBhSIEQv////8PgyIFIAEpAzAgAnxBACkDsIwBhSIGQiCIIgd+IghC/////w+DIARCIIgiBCAGQv////8PgyIGfnwgBSAGfiIFQiCIfCIGQiCGIAVC/////w+DhCAIQiCIIAQgB358IAZCIIh8hSABKQMoIAJ9QQApA6iMAYUiBEL/////D4MiBSABKQMgIAJ8QQApA6CMAYUiBkIgiCIHfiIIQv////8PgyAEQiCIIgQgBkL/////D4MiBn58IAUgBn4iBUIgiHwiBkIghiAFQv////8Pg4QgCEIgiCAEIAd+fCAGQiCIfIUgASkDGCACfUEAKQOYjAGFIgRC/////w+DIgUgASkDECACfEEAKQOQjAGFIgZCIIgiB34iCEL/////D4MgBEIgiCIEIAZC/////w+DIgZ+fCAFIAZ+IgVCIIh8IgZCIIYgBUL/////D4OEIAhCIIggBCAHfnwgBkIgiHyFIAEpAwggAn1BACkDiIwBhSIEQv////8PgyIFIAEpAwAgAnxBACkDgIwBhSIGQiCIIgd+IghC/////w+DIARCIIgiBCAGQv////8PgyIGfnwgBSAGfiIFQiCIfCIGQiCGIAVC/////w+DhCAIQiCIIAQgB358IAZCIIh8hSAArUKHla+vmLbem55/fnx8fHx8fHx8IgRCJYggBIVC+fPd8ZnymasWfiIEQiCIIASFIQQCQCAAQZABSA0AIABBBHZBeGohCQNAIAEgA2oiCkELaikDACACfSADQYiNAWopAwCFIgVC/////w+DIgYgCkEDaikDACACfCADQYCNAWopAwCFIgdCIIgiCH4iC0L/////D4MgBUIgiCIFIAdC/////w+DIgd+fCAGIAd+IgZCIIh8IgdCIIYgBkL/////D4OEIAtCIIggBSAIfnwgB0IgiHyFIAR8IQQgA0EQaiEDIAlBf2oiCQ0ACwsgASkDfyACfSAAQfiLAWopAwCFIgVC/////w+DIgYgASkDdyACfCAAQfCLAWopAwCFIgJCIIgiB34iCEL/////D4MgBUIgiCIFIAJC/////w+DIgJ+fCAGIAJ+IgJCIIh8IgZCIIYgAkL/////D4OEIAhCIIggBSAHfnwgBkIgiHyFIAR8IgJCJYggAoVC+fPd8ZnymasWfiICQiCIIAKFC98FAgF+AX8CQAJAQQApA4AKIgBQRQ0AQYAIIQFCACEADAELAkBBACkDoI4BIABSDQBBACEBDAELQQAhAUEAQq+v79e895Kg/gAgAH03A/iLAUEAIABCxZbr+djShYIofDcD8IsBQQBCj/Hjja2P9JhOIAB9NwPoiwFBACAAQqus+MXV79HQfHw3A+CLAUEAQtOt1LKShbW0nn8gAH03A9iLAUEAIABCl5r0jvWWvO3JAHw3A9CLAUEAQsWDgv2v/8SxayAAfTcDyIsBQQAgAELqi7OdyOb09UN8NwPAiwFBAELIv/rLnJveueQAIAB9NwO4iwFBACAAQoqjgd/Ume2sMXw3A7CLAUEAQvm57738+MKnHSAA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QQApA4CKATcDACACQQApA4iKATcDCCACQQApA5CKATcDECACQQApA5iKATcDGCACQQApA6CKATcDICACQQApA6iKATcDKCACQQApA7CKASIFNwMwIAJBACkDuIoBIgY3AzgCQAJAQQAoAoCOASIHQcAASQ0AIAJBACgCiI4BNgJAIAIgAkHAAGpBACgCmI4BQYCMASAHQX9qQQZ2IANBACgCnI4BIgAQAiADIABqIgBBeWopAwAhCCAAKQMJIQkgACkDGSEKIAApAykhCyAHQcCLAWopAwAhBSAAKQMBIQwgB0HIiwFqKQMAIQYgB0HQiwFqKQMAIQ0gACkDESEOIAdB2IsBaikDACEPIAdB4IsBaikDACEQIAApAyEhESAHQeiLAWopAwAhEiACKQMAIRMgAikDECEUIAIpAyAhFSACKQMwIRYgAikDCCEXIAIpAxghGCACKQMoIRkgAiACKQM4IAdB8IsBaikDACIafCAAKQMxIAdB+IsBaikDACIbhSIcQiCIIBxC/////w+Dfnw3AzggGSAQfCARIBKFIhFCIIggEUL/////D4N+fCERIBggDXwgDiAPhSIOQiCIIA5C/////w+DfnwhDiAXIAV8IAwgBoUiDEIgiCAMQv////8Pg358IQwgGyAWIAsgGoUiC0IgiCALQv////8Pg358fCELIBIgFSAKIBCFIhBCIIggEEL/////D4N+fHwhECAPIBQgCSANhSINQiCIIA1C/////w+Dfnx8IRIgBiATIAggBYUiBUIgiCAFQv////8Pg358fCEIDAELIAdBwI0BaiEdQcAAIAdrIR4gAkHAAGohAAJAAkACQCAHQThNDQAgHiEfDAELAkACQEE4IAdrQQN2QQFqQQdxIh8NACACQcAAaiEAIB4hHwwBCyACQcAAaiEAIB9BA3QiICEfA0AgACAdKQMANwMAIABBCGohACAdQQhqIR0gH0F4aiIfDQALQcAAIAcgIGprIR8LAkAgBw0AA0AgACAdKQMANwMAIABBCGogHUEIaikDADcDACAAQRBqIB1BEGopAwA3AwAgAEEYaiAdQRhqKQMANwMAIABBIGogHUEgaikDADcDACAAQShqIB1BKGopAwA3AwAgAEEwaiAdQTBqKQMANwMAIABBOGogHUE4aikDADcDACAAQcAAaiEAIB1BwABqIR0gH0FAaiIfQQdLDQALCyAfRQ0BCyAfQX9qISECQCAfQQdxIiBFDQAgH0F4cSEfA0AgACAdLQAAOgAAIABBAWohACAdQQFqIR0gIEF/aiIgDQALCyAhQQdJDQADQCAAIB0pAAA3AAAgAEEIaiEAIB1BCGohHSAfQXhqIh8NAAsLIAJBwABqIB5qIR1BgIwBIQACQAJAAkAgB0EISQ0AAkAgB0E4akEDdkEBakEHcSIfDQAMAgsgH0EDdCEgQYCMASEAA0AgHSAAKQMANwMAIB1BCGohHSAAQQhqIQAgH0F/aiIfDQALIAcgIGshBwsgB0UNAQJAAkAgB0EHcSIgDQAgByEfDAELIAdBeHEhHwNAIB0gAC0AADoAACAdQQFqIR0gAEEBaiEAICBBf2oiIA0ACwsgB0EISQ0BCwNAIB0gACkAADcAACAdQQhqIR0gAEEIaiEAIB9BeGoiHw0ACwsgA0EAKAKcjgFqIgBBeWopAwAhCiAAKQMJIRMgACkDGSEUIAApAykhCyAAKQMBIQwgACkDESEOIAApAyEhESACKQMAIRUgAikDECEWIAIpAyAhFyACKQMIIRggAikDQCENIAIpA0ghDyACKQMYIRkgAikDUCESIAIpA1ghCCACKQMoIRogAikDYCEQIAIpA2ghCSACIAYgAikDcCIbfCAAKQMxIAIpA3giBoUiHEIgiCAcQv////8Pg358NwM4IBogEHwgESAJhSIRQiCIIBFC/////w+DfnwhESAZIBJ8IA4gCIUiDkIgiCAOQv////8Pg358IQ4gGCANfCAMIA+FIgxCIIggDEL/////D4N+fCEMIAYgCyAbhSILQiCIIAtC/////w+DfiAFfHwhCyAJIBcgFCAQhSIFQiCIIAVC/////w+Dfnx8IRAgCCAWIBMgEoUiBUIgiCAFQv////8Pg358fCESIA8gFSAKIA2FIgVCIIggBUL/////D4N+fHwhCAsgAykDQyACKQM4hSIFQv////8PgyIGIAMpAzsgC4UiC0IgiCINfiIPQv////8PgyAFQiCIIgUgC0L/////D4MiC358IAYgC34iBkIgiHwiC0IghiAGQv////8Pg4QgD0IgiCAFIA1+fCALQiCIfIUgAykDMyARhSIFQv////8PgyIGIAMpAysgEIUiC0IgiCINfiIPQv////8PgyAFQiCIIgUgC0L/////D4MiC358IAYgC34iBkIgiHwiC0IghiAGQv////8Pg4QgD0IgiCAFIA1+fCALQiCIfIUgAykDIyAOhSIFQv////8PgyIGIAMpAxsgEoUiC0IgiCINfiIPQv////8PgyAFQiCIIgUgC0L/////D4MiC358IAYgC34iBkIgiHwiC0IghiAGQv////8Pg4QgD0IgiCAFIA1+fCALQiCIfIUgAykDEyAMhSIFQv////8PgyIGIAMpAwsgCIUiC0IgiCINfiIPQv////8PgyAFQiCIIgUgC0L/////D4MiC358IAYgC34iBkIgiHwiC0IghiAGQv////8Pg4QgD0IgiCAFIA1+fCALQiCIfIUgBEKHla+vmLbem55/fnx8fHwiBEIliCAEhUL5893xmfKZqxZ+IgRCIIggBIUhBAwBCyAEpyEAAkBBACkDoI4BIgRQDQACQCAAQRBLDQAgAEGACCAEEAUhBAwCCwJAIABBgAFLDQAgAEGACCAEEAYhBAwCCyAAQYAIIAQQByEEDAELAkAgAEEQSw0AIAAgA0IAEAUhBAwBCwJAIABBgAFLDQAgACADQgAQBiEEDAELIAAgA0IAEAchBAtBACAEQjiGIARCgP4Dg0IohoQgBEKAgPwHg0IYhiAEQoCAgPgPg0IIhoSEIARCCIhCgICA+A+DIARCGIhCgID8B4OEIARCKIhCgP4DgyAEQjiIhISENwOACiABJAALBgBBgIoBCwIACwvMAQEAQYAIC8QBuP5sOSOkS758AYEs9yGtHN7UbemDkJfbckCkpLezZx/LeeZOzMDleIJa0H3M/3IhuAhGdPdDJI7gNZDmgTomTDwoUruRwwDLiNBlixtTLqNxZEiXog35TjgZ70ap3qzYqPp2P+OcND/53LvHxwtPHYpR4EvNtFkxyJ9+ydl4c2TqxayDNNPrw8WBoP/6E2PrFw3dUbfw2knTFlUmKdRonisWvlh9R6H8j/i40XrQMc5FyzqPlRYEKK/X+8q7S0B+QAIAAA==";
      var hash$6 = "5a2fbdbb";
      var wasmJson$6 = {
        name: name$6,
        data: data$6,
        hash: hash$6
      };
      const mutex$4 = new Mutex();
      let wasmCache$4 = null;
      const seedBuffer$1 = new Uint8Array(8);
      function validateSeed$1(seed) {
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
          return new Error("Seed must be given as two valid 32-bit long unsigned integers (lo + high).");
        }
        return null;
      }
      function writeSeed$1(arr, low, high) {
        const buffer = new DataView(arr);
        buffer.setUint32(0, low, true);
        buffer.setUint32(4, high, true);
      }
      function xxhash3(data2, seedLow = 0, seedHigh = 0) {
        if (validateSeed$1(seedLow)) {
          return Promise.reject(validateSeed$1(seedLow));
        }
        if (validateSeed$1(seedHigh)) {
          return Promise.reject(validateSeed$1(seedHigh));
        }
        if (wasmCache$4 === null) {
          return lockedCreate(mutex$4, wasmJson$6, 8).then((wasm) => {
            wasmCache$4 = wasm;
            writeSeed$1(seedBuffer$1.buffer, seedLow, seedHigh);
            wasmCache$4.writeMemory(seedBuffer$1);
            return wasmCache$4.calculate(data2);
          });
        }
        try {
          writeSeed$1(seedBuffer$1.buffer, seedLow, seedHigh);
          wasmCache$4.writeMemory(seedBuffer$1);
          const hash2 = wasmCache$4.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createXXHash3(seedLow = 0, seedHigh = 0) {
        if (validateSeed$1(seedLow)) {
          return Promise.reject(validateSeed$1(seedLow));
        }
        if (validateSeed$1(seedHigh)) {
          return Promise.reject(validateSeed$1(seedHigh));
        }
        return WASMInterface(wasmJson$6, 8).then((wasm) => {
          const instanceBuffer = new Uint8Array(8);
          writeSeed$1(instanceBuffer.buffer, seedLow, seedHigh);
          wasm.writeMemory(instanceBuffer);
          wasm.init();
          const obj = {
            init: () => {
              wasm.writeMemory(instanceBuffer);
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 512,
            digestSize: 8
          };
          return obj;
        });
      }
      var name$5 = "xxhash128";
      var data$5 = "AGFzbQEAAAABKwdgAAF/YAR/f39/AGAHf39/f39/fwBgA39/fgF+YAR/f39+AGAAAGABfwADDQwAAQIDBAQEBQYFAAUFBAEBAgIGDgJ/AUHAjgULfwBBwAkLB3AIBm1lbW9yeQIADkhhc2hfR2V0QnVmZmVyAAAJSGFzaF9Jbml0AAcLSGFzaF9VcGRhdGUACApIYXNoX0ZpbmFsAAkNSGFzaF9HZXRTdGF0ZQAKDkhhc2hfQ2FsY3VsYXRlAAsKU1RBVEVfU0laRQMBCqBNDAUAQYAKC+QDAw9+AX8BfgJAIANFDQAgACkDMCEEIAApAzghBSAAKQMgIQYgACkDKCEHIAApAxAhCCAAKQMYIQkgACkDACEKIAApAwghCwNAIAUgAUEwaikDACIMfCACQThqKQMAIAFBOGopAwAiDYUiBUIgiCAFQv////8Pg358IQUgByABQSBqKQMAIg58IAJBKGopAwAgAUEoaikDACIPhSIHQiCIIAdC/////w+DfnwhByAJIAFBEGopAwAiEHwgAkEYaikDACABQRhqKQMAIhGFIglCIIggCUL/////D4N+fCEJIAsgASkDACISfCACQQhqIhMpAwAgAUEIaikDACIUhSILQiCIIAtC/////w+DfnwhCyACQTBqKQMAIAyFIgxCIIggDEL/////D4N+IAR8IA18IQQgAkEgaikDACAOhSIMQiCIIAxC/////w+DfiAGfCAPfCEGIAJBEGopAwAgEIUiDEIgiCAMQv////8Pg34gCHwgEXwhCCACKQMAIBKFIgxCIIggDEL/////D4N+IAp8IBR8IQogAUHAAGohASATIQIgA0F/aiIDDQALIAAgCTcDGCAAIAo3AwAgACALNwMIIAAgBzcDKCAAIAg3AxAgACAFNwM4IAAgBjcDICAAIAQ3AzALC94CAgF/AX4CQCAEIAIgASgCACIHayICSQ0AIAAgAyAFIAdBA3RqIAIQASAAIAUgBmoiBykDACAAKQMAIghCL4iFIAiFQrHz3fEJfjcDACAAIAcpAwggACkDCCIIQi+IhSAIhUKx893xCX43AwggACAHKQMQIAApAxAiCEIviIUgCIVCsfPd8Ql+NwMQIAAgBykDGCAAKQMYIghCL4iFIAiFQrHz3fEJfjcDGCAAIAcpAyAgACkDICIIQi+IhSAIhUKx893xCX43AyAgACAHKQMoIAApAygiCEIviIUgCIVCsfPd8Ql+NwMoIAAgBykDMCAAKQMwIghCL4iFIAiFQrHz3fEJfjcDMCAAIAcpAzggACkDOCIIQi+IhSAIhUKx893xCX43AzggACADIAJBBnRqIAUgBCACayIHEAEgASAHNgIADwsgACADIAUgB0EDdGogBBABIAEgByAEajYCAAvtAwEFfiABKQM4IAApAziFIgNC/////w+DIgQgASkDMCAAKQMwhSIFQiCIIgZ+IgdC/////w+DIANCIIgiAyAFQv////8PgyIFfnwgBCAFfiIEQiCIfCIFQiCGIARC/////w+DhCAHQiCIIAMgBn58IAVCIIh8hSABKQMoIAApAyiFIgNC/////w+DIgQgASkDICAAKQMghSIFQiCIIgZ+IgdC/////w+DIANCIIgiAyAFQv////8PgyIFfnwgBCAFfiIEQiCIfCIFQiCGIARC/////w+DhCAHQiCIIAMgBn58IAVCIIh8hSABKQMYIAApAxiFIgNC/////w+DIgQgASkDECAAKQMQhSIFQiCIIgZ+IgdC/////w+DIANCIIgiAyAFQv////8PgyIFfnwgBCAFfiIEQiCIfCIFQiCGIARC/////w+DhCAHQiCIIAMgBn58IAVCIIh8hSABKQMIIAApAwiFIgNC/////w+DIgQgASkDACAAKQMAhSIFQiCIIgZ+IgdC/////w+DIANCIIgiAyAFQv////8PgyIFfnwgBCAFfiIEQiCIfCIFQiCGIARC/////w+DhCAHQiCIIAMgBn58IAVCIIh8hSACfHx8fCICQiWIIAKFQvnz3fGZ8pmrFn4iAkIgiCAChQu6CAIFfgN/AkAgAUEJSQ0AIAAgAUH4iwFqKQMAIgQgAikDOCACKQMwhSADfIUiBUL/////D4NC95Svrwh+IAVCgICAgHCDfEEAKQOAjAEgAikDKCACKQMghSADfYUgBIUiA0IgiCIEQrHz3fEJfnwgBEKHla+vCH4iBEIgiHwgBEL/////D4MgA0L/////D4MiA0Kx893xCX58IANCh5Wvrwh+IgRCIIh8IgVCIIh8IgNCOIYgA0KA/gODQiiGhCADQoCA/AeDQhiGIANCgICA+A+DQgiGhIQgA0IIiEKAgID4D4MgA0IYiEKAgPwHg4QgA0IoiEKA/gODIANCOIiEhIQgBEL/////D4MgAUF/aq1CNoaEIAVCIIZ8hSIEQiCIIgVCz9bTvgJ+IgZC/////w+DIARC/////w+DIgRCvdzKlQx+fCAEQs/W074CfiIEQiCIfCIHQiCGIghCJYggCCAEQv////8Pg4SFQvnz3fGZ8pmrFn4iBEIgiCAEhTcDACAAIAVCvdzKlQx+IANCz9bTvtLHq9lCfnwgBkIgiHwgB0IgiHwiA0IliCADhUL5893xmfKZqxZ+IgNCIIggA4U3AwgPCwJAIAFBBEkNACAAIAIpAxggAikDEIUgA6ciAkEYdCACQYD+A3FBCHRyIAJBCHZBgP4DcSACQRh2cnKtQiCGIAOFfCABQfyLAWo1AgBCIIZBADUCgIwBhIUiA0IgiCIEIAFBAnRBh5Wvr3hqrSIFfiIGQiCIIARCsfPd8Ql+fCAGQv////8PgyADQv////8PgyIDQrHz3fEJfnwgAyAFfiIDQiCIfCIEQiCIfCAEQiCGIANC/////w+DhCIEQgGGfCIDQiWIIAOFQvnz3fGZ8pmrFn4iBUIgiCAFhTcDCCAAIANCA4ggBIUiA0IjiCADhUKlvuP00YyH2Z9/fiIDQhyIIAOFNwMADwsCQCABRQ0AIAAgAigCBCACKAIAc60gA3wiBEIhiEEALQCAjAFBEHQgAUEIdHIiCSABQQF2QYCMAWotAABBGHRyIgogAUH/iwFqLQAAIgFyIguthSAEhULP1tO+0ser2UJ+IgRCHYggBIVC+fPd8Zn2masWfiIEQiCIIASFNwMAIAAgAigCDCACKAIIc60gA30iA0IhiCABQRh0IAtBgP4DcUEIdHIgCUEIdkGA/gNxIApBGHZyckENd62FIAOFQs/W077Sx6vZQn4iA0IdiCADhUL5893xmfaZqxZ+IgNCIIggA4U3AwgPCyAAIAIpA1AgAikDWIUgA4UiBEIhiCAEhULP1tO+0ser2UJ+IgRCHYggBIVC+fPd8Zn2masWfiIEQiCIIASFNwMIIAAgAikDQCACKQNIhSADhSIDQiGIIAOFQs/W077Sx6vZQn4iA0IdiCADhUL5893xmfaZqxZ+IgNCIIggA4U3AwALwwoBCn4gAa0iBEKHla+vmLbem55/fiEFAkACQCABQSFPDQBCACEGDAELQgAhBwJAIAFBwQBJDQBCACEHAkAgAUHhAEkNACACQfgAaikDACADfSABQciLAWopAwAiCIUiB0L/////D4MiCSACKQNwIAN8IAFBwIsBaikDACIKhSILQiCIIgx+Ig1CIIggB0IgiCIHIAx+fCANQv////8PgyAHIAtC/////w+DIgt+fCAJIAt+IgdCIIh8IglCIIh8QQApA7iMASILQQApA7CMASIMfIUgCUIghiAHQv////8Pg4SFIQcgAkHoAGopAwAgA30gC4UiCUL/////D4MiCyACKQNgIAN8IAyFIgxCIIgiDX4iBkL/////D4MgCUIgiCIJIAxC/////w+DIgx+fCALIAx+IgtCIIh8IgxCIIYgC0L/////D4OEIAZCIIggCSANfnwgDEIgiHyFIAV8IAggCnyFIQULIAJB2ABqKQMAIAN9IAFB2IsBaikDACIIhSIJQv////8PgyIKIAIpA1AgA3wgAUHQiwFqKQMAIguFIgxCIIgiDX4iBkL/////D4MgCUIgiCIJIAxC/////w+DIgx+fCAKIAx+IgpCIIh8IgxCIIYgCkL/////D4OEIAZCIIggCSANfnwgDEIgiHyFIAd8QQApA6iMASIJQQApA6CMASIKfIUhByACQcgAaikDACADfSAJhSIJQv////8PgyIMIAIpA0AgA3wgCoUiCkIgiCINfiIGQv////8PgyAJQiCIIgkgCkL/////D4MiCn58IAwgCn4iCkIgiHwiDEIghiAKQv////8Pg4QgBkIgiCAJIA1+fCAMQiCIfIUgBXwgCCALfIUhBQsgAkE4aikDACADfSABQeiLAWopAwAiCIUiCUL/////D4MiCiACKQMwIAN8IAFB4IsBaikDACILhSIMQiCIIg1+IgZC/////w+DIAlCIIgiCSAMQv////8PgyIMfnwgCiAMfiIKQiCIfCIMQiCGIApC/////w+DhCAGQiCIIAkgDX58IAxCIIh8hSAHfEEAKQOYjAEiB0EAKQOQjAEiCXyFIQYgAkEoaikDACADfSAHhSIHQv////8PgyIKIAIpAyAgA3wgCYUiCUIgiCIMfiINQv////8PgyAHQiCIIgcgCUL/////D4MiCX58IAogCX4iCUIgiHwiCkIghiAJQv////8Pg4QgDUIgiCAHIAx+fCAKQiCIfIUgBXwgCCALfIUhBQsgACACQRhqKQMAIAN9IAFB+IsBaikDACIHhSIIQv////8PgyIJIAIpAxAgA3wgAUHwiwFqKQMAIgqFIgtCIIgiDH4iDUL/////D4MgCEIgiCIIIAtC/////w+DIgt+fCAJIAt+IglCIIh8IgtCIIYgCUL/////D4OEIA1CIIggCCAMfnwgC0IgiHyFIAZ8QQApA4iMASIIQQApA4CMASIJfIUiCyACQQhqKQMAIAN9IAiFIghC/////w+DIgwgAikDACADfCAJhSIJQiCIIg1+IgZC/////w+DIAhCIIgiCCAJQv////8PgyIJfnwgDCAJfiIJQiCIfCIMQiCGIAlC/////w+DhCAGQiCIIAggDX58IAxCIIh8hSAFfCAHIAp8hSIFfCIHQiWIIAeFQvnz3fGZ8pmrFn4iB0IgiCAHhTcDACAAQgAgBUKHla+vmLbem55/fiAEIAN9Qs/W077Sx6vZQn58IAtC49zKlfzO8vWFf358IgNCJYggA4VC+fPd8ZnymasWfiIDQiCIIAOFfTcDCAuhDwMBfxR+An9BACEEIAJB+ABqKQMAIAN9QQApA/iMASIFhSIGQv////8PgyIHIAIpA3AgA3xBACkD8IwBIgiFIglCIIgiCn4iC0L/////D4MgBkIgiCIGIAlC/////w+DIgl+fCAHIAl+IgdCIIh8IglCIIYgB0L/////D4OEIAtCIIggBiAKfnwgCUIgiHyFIAJB2ABqKQMAIAN9QQApA9iMASIHhSIGQv////8PgyIJIAIpA1AgA3xBACkD0IwBIgqFIgtCIIgiDH4iDUL/////D4MgBkIgiCIGIAtC/////w+DIgt+fCAJIAt+IglCIIh8IgtCIIYgCUL/////D4OEIA1CIIggBiAMfnwgC0IgiHyFIAJBOGopAwAgA31BACkDuIwBIgmFIgZC/////w+DIgsgAikDMCADfEEAKQOwjAEiDIUiDUIgiCIOfiIPQv////8PgyAGQiCIIgYgDUL/////D4MiDX58IAsgDX4iC0IgiHwiDUIghiALQv////8Pg4QgD0IgiCAGIA5+fCANQiCIfIUgAkEYaikDACADfUEAKQOYjAEiC4UiBkL/////D4MiDSACKQMQIAN8QQApA5CMASIOhSIPQiCIIhB+IhFC/////w+DIAZCIIgiBiAPQv////8PgyIPfnwgDSAPfiINQiCIfCIPQiCGIA1C/////w+DhCARQiCIIAYgEH58IA9CIIh8hUEAKQOIjAEiDUEAKQOAjAEiD3yFfEEAKQOojAEiEEEAKQOgjAEiEXyFfEEAKQPIjAEiEkEAKQPAjAEiE3yFfEEAKQPojAEiFEEAKQPgjAEiFXyFIgZCJYggBoVC+fPd8ZnymasWfiIGQiCIIAaFIQYgAkHoAGopAwAgA30gFIUiFEL/////D4MiFiACKQNgIAN8IBWFIhVCIIgiF34iGEL/////D4MgFEIgiCIUIBVC/////w+DIhV+fCAWIBV+IhVCIIh8IhZCIIYgFUL/////D4OEIBhCIIggFCAXfnwgFkIgiHyFIAJByABqKQMAIAN9IBKFIhJC/////w+DIhQgAikDQCADfCAThSITQiCIIhV+IhZC/////w+DIBJCIIgiEiATQv////8PgyITfnwgFCATfiITQiCIfCIUQiCGIBNC/////w+DhCAWQiCIIBIgFX58IBRCIIh8hSACQShqKQMAIAN9IBCFIhBC/////w+DIhIgAikDICADfCARhSIRQiCIIhN+IhRC/////w+DIBBCIIgiECARQv////8PgyIRfnwgEiARfiIRQiCIfCISQiCGIBFC/////w+DhCAUQiCIIBAgE358IBJCIIh8hSACQQhqKQMAIAN9IA2FIg1C/////w+DIhAgAikDACADfCAPhSIPQiCIIhF+IhJC/////w+DIA1CIIgiDSAPQv////8PgyIPfnwgECAPfiIPQiCIfCIQQiCGIA9C/////w+DhCASQiCIIA0gEX58IBBCIIh8hSABrSIPQoeVr6+Ytt6bnn9+fCALIA58hXwgCSAMfIV8IAcgCnyFfCAFIAh8hSIFQiWIIAWFQvnz3fGZ8pmrFn4iBUIgiCAFhSEFAkAgAUGgAUgNACABQQV2QXxqIRkDQCACIARqIhpBG2opAwAgA30gBEGYjQFqKQMAIgeFIghC/////w+DIgkgGkETaikDACADfCAEQZCNAWopAwAiCoUiC0IgiCIMfiINQv////8PgyAIQiCIIgggC0L/////D4MiC358IAkgC34iCUIgiHwiC0IghiAJQv////8Pg4QgDUIgiCAIIAx+fCALQiCIfIUgBnwgBEGIjQFqKQMAIgggBEGAjQFqKQMAIgl8hSEGIBpBC2opAwAgA30gCIUiCEL/////D4MiCyAaQQNqKQMAIAN8IAmFIglCIIgiDH4iDUL/////D4MgCEIgiCIIIAlC/////w+DIgl+fCALIAl+IglCIIh8IgtCIIYgCUL/////D4OEIA1CIIggCCAMfnwgC0IgiHyFIAV8IAcgCnyFIQUgBEEgaiEEIBlBf2oiGQ0ACwsgACACQf8AaikDACADfCABQeiLAWopAwAiB4UiCEL/////D4MiCSACKQN3IAN9IAFB4IsBaikDACIKhSILQiCIIgx+Ig1C/////w+DIAhCIIgiCCALQv////8PgyILfnwgCSALfiIJQiCIfCILQiCGIAlC/////w+DhCANQiCIIAggDH58IAtCIIh8hSAGfCABQfiLAWopAwAiBiABQfCLAWopAwAiCHyFIgkgAkHvAGopAwAgA3wgBoUiBkL/////D4MiCyACKQNnIAN9IAiFIghCIIgiDH4iDUL/////D4MgBkIgiCIGIAhC/////w+DIgh+fCALIAh+IghCIIh8IgtCIIYgCEL/////D4OEIA1CIIggBiAMfnwgC0IgiHyFIAV8IAcgCnyFIgZ8IgVCJYggBYVC+fPd8ZnymasWfiIFQiCIIAWFNwMAIABCACAGQoeVr6+Ytt6bnn9+IA8gA31Cz9bTvtLHq9lCfnwgCULj3MqV/M7y9YV/fnwiA0IliCADhUL5893xmfKZqxZ+IgNCIIggA4V9NwMIC98FAgF+AX8CQAJAQQApA4AKIgBQRQ0AQYAIIQFCACEADAELAkBBACkDoI4BIABSDQBBACEBDAELQQAhAUEAQq+v79e895Kg/gAgAH03A/iLAUEAIABCxZbr+djShYIofDcD8IsBQQBCj/Hjja2P9JhOIAB9NwPoiwFBACAAQqus+MXV79HQfHw3A+CLAUEAQtOt1LKShbW0nn8gAH03A9iLAUEAIABCl5r0jvWWvO3JAHw3A9CLAUEAQsWDgv2v/8SxayAAfTcDyIsBQQAgAELqi7OdyOb09UN8NwPAiwFBAELIv/rLnJveueQAIAB9NwO4iwFBACAAQoqjgd/Ume2sMXw3A7CLAUEAQvm57738+MKnHSAAfTcDqIsBQQAgAEKo9dv7s5ynmj98NwOgiwFBAEK4sry3lNW31lggAH03A5iLAUEAIABC8cihuqm0w/zOAHw3A5CLAUEAQoihl9u445SXo38gAH03A4iL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AkHAAGogDGohC0GAjAEhAAJAAkACQCAHQQhJDQACQCAHQThqQQN2QQFqQQdxIg0NAAwCCyANQQN0IQ5BgIwBIQADQCALIAApAwA3AwAgC0EIaiELIABBCGohACANQX9qIg0NAAsgByAOayEHCyAHRQ0BAkACQCAHQQdxIg4NACAHIQ0MAQsgB0F4cSENA0AgCyAALQAAOgAAIAtBAWohCyAAQQFqIQAgDkF/aiIODQALCyAHQQhJDQELA0AgCyAAKQAANwAAIAtBCGohCyAAQQhqIQAgDUF4aiINDQALCyACIAIpAwggAikDQCIIfCADQQAoApyOAWoiACkDASACKQNIIgmFIgpCIIggCkL/////D4N+fDcDCCACIAIpAxggAikDUCIKfCAAKQMRIAIpA1giEIUiEUIgiCARQv////8Pg358NwMYIAIgECAKIAApAwmFIgpCIIggCkL/////D4N+IAIpAxB8fDcDECACIAkgCCAAQXlqKQMAhSIIQiCIIAhC/////w+DfiACKQMAfHw3AwAgACkDGSEIIAIpAyAhCSACIAIpAyggAikDYCIKfCAAKQMhIAIpA2giEIUiEUIgiCARQv////8Pg358NwMoIAIgECAJIAggCoUiCEIgiCAIQv////8Pg358fDcDICACIAYgAikDcCIIfCAAKQMxIAIpA3giBoUiCUIgiCAJQv////8Pg358NwM4IAIgBiAIIAApAymFIghCIIggCEL/////D4N+IAV8fDcDMAsgAiACIANBC2ogBEKHla+vmLbem55/fhADNwNAIAIgAiADQQAoApyOAWpBdWogBELP1tO+0ser2UJ+Qn+FEAM3A0gMAQsgBKchAAJAQQApA6COASIEUA0AAkAgAEEQSw0AIAJBwABqIABBgAggBBAEDAILAkAgAEGAAUsNACACQcAAaiAAQYAIIAQQBQwCCyACQcAAaiAAQYAIIAQQBgwBCwJAIABBEEsNACACQcAAaiAAIANCABAEDAELAkAgAEGAAUsNACACQcAAaiAAIANCABAFDAELIAJBwABqIAAgA0IAEAYLQQAgAikDcDcDuApBACACKQNgNwOoCkEAIAIpA1A3A5gKQQAgAkH4AGopAwA3A8AKQQAgAkHoAGopAwA3A7AKQQAgAkHYAGopAwA3A6AKQQAgAikDSCIEQjiGIARCgP4Dg0IohoQgBEKAgPwHg0IYhiAEQoCAgPgPg0IIhoSEIARCCIhCgICA+A+DIARCGIhCgID8B4OEIARCKIhCgP4DgyAEQjiIhISEIgQ3A4AKQQAgBDcDkApBACACKQNAIgRCOIYgBEKA/gODQiiGhCAEQoCA/AeDQhiGIARCgICA+A+DQgiGhIQgBEIIiEKAgID4D4MgBEIYiEKAgPwHg4QgBEIoiEKA/gODIARCOIiEhIQ3A4gKIAEkAAsGAEGAigELAgALC8wBAQBBgAgLxAG4/mw5I6RLvnwBgSz3Ia0c3tRt6YOQl9tyQKSkt7NnH8t55k7MwOV4glrQfcz/ciG4CEZ090MkjuA1kOaBOiZMPChSu5HDAMuI0GWLG1Muo3FkSJeiDflOOBnvRqnerNio+nY/45w0P/ncu8fHC08dilHgS820WTHIn37J2XhzZOrFrIM00+vDxYGg//oTY+sXDd1Rt/DaSdMWVSYp1GieKxa+WH1HofyP+LjRetAxzkXLOo+VFgQor9f7yrtLQH5AAgAA";
      var hash$5 = "b9ab74e2";
      var wasmJson$5 = {
        name: name$5,
        data: data$5,
        hash: hash$5
      };
      const mutex$3 = new Mutex();
      let wasmCache$3 = null;
      const seedBuffer = new Uint8Array(8);
      function validateSeed(seed) {
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
          return new Error("Seed must be given as two valid 32-bit long unsigned integers (lo + high).");
        }
        return null;
      }
      function writeSeed(arr, low, high) {
        const buffer = new DataView(arr);
        buffer.setUint32(0, low, true);
        buffer.setUint32(4, high, true);
      }
      function xxhash128(data2, seedLow = 0, seedHigh = 0) {
        if (validateSeed(seedLow)) {
          return Promise.reject(validateSeed(seedLow));
        }
        if (validateSeed(seedHigh)) {
          return Promise.reject(validateSeed(seedHigh));
        }
        if (wasmCache$3 === null) {
          return lockedCreate(mutex$3, wasmJson$5, 16).then((wasm) => {
            wasmCache$3 = wasm;
            writeSeed(seedBuffer.buffer, seedLow, seedHigh);
            wasmCache$3.writeMemory(seedBuffer);
            return wasmCache$3.calculate(data2);
          });
        }
        try {
          writeSeed(seedBuffer.buffer, seedLow, seedHigh);
          wasmCache$3.writeMemory(seedBuffer);
          const hash2 = wasmCache$3.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createXXHash128(seedLow = 0, seedHigh = 0) {
        if (validateSeed(seedLow)) {
          return Promise.reject(validateSeed(seedLow));
        }
        if (validateSeed(seedHigh)) {
          return Promise.reject(validateSeed(seedHigh));
        }
        return WASMInterface(wasmJson$5, 16).then((wasm) => {
          const instanceBuffer = new Uint8Array(8);
          writeSeed(instanceBuffer.buffer, seedLow, seedHigh);
          wasm.writeMemory(instanceBuffer);
          wasm.init();
          const obj = {
            init: () => {
              wasm.writeMemory(instanceBuffer);
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 512,
            digestSize: 16
          };
          return obj;
        });
      }
      var name$4 = "ripemd160";
      var data$4 = "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";
      var hash$4 = "6abbce74";
      var wasmJson$4 = {
        name: name$4,
        data: data$4,
        hash: hash$4
      };
      const mutex$2 = new Mutex();
      let wasmCache$2 = null;
      function ripemd160(data2) {
        if (wasmCache$2 === null) {
          return lockedCreate(mutex$2, wasmJson$4, 20).then((wasm) => {
            wasmCache$2 = wasm;
            return wasmCache$2.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache$2.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createRIPEMD160() {
        return WASMInterface(wasmJson$4, 20).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 20
          };
          return obj;
        });
      }
      function calculateKeyBuffer(hasher, key) {
        const { blockSize } = hasher;
        const buf = getUInt8Buffer(key);
        if (buf.length > blockSize) {
          hasher.update(buf);
          const uintArr = hasher.digest("binary");
          hasher.init();
          return uintArr;
        }
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
      }
      function calculateHmac(hasher, key) {
        hasher.init();
        const { blockSize } = hasher;
        const keyBuf = calculateKeyBuffer(hasher, key);
        const keyBuffer = new Uint8Array(blockSize);
        keyBuffer.set(keyBuf);
        const opad = new Uint8Array(blockSize);
        for (let i = 0; i < blockSize; i++) {
          const v = keyBuffer[i];
          opad[i] = v ^ 92;
          keyBuffer[i] = v ^ 54;
        }
        hasher.update(keyBuffer);
        const obj = {
          init: () => {
            hasher.init();
            hasher.update(keyBuffer);
            return obj;
          },
          update: (data2) => {
            hasher.update(data2);
            return obj;
          },
          digest: ((outputType) => {
            const uintArr = hasher.digest("binary");
            hasher.init();
            hasher.update(opad);
            hasher.update(uintArr);
            return hasher.digest(outputType);
          }),
          save: () => {
            throw new Error("save() not supported");
          },
          load: () => {
            throw new Error("load() not supported");
          },
          blockSize: hasher.blockSize,
          digestSize: hasher.digestSize
        };
        return obj;
      }
      function createHMAC(hash2, key) {
        if (!hash2 || !hash2.then) {
          throw new Error('Invalid hash function is provided! Usage: createHMAC(createMD5(), "key").');
        }
        return hash2.then((hasher) => calculateHmac(hasher, key));
      }
      function calculatePBKDF2(digest, salt, iterations, hashLength, outputType) {
        return __awaiter(this, void 0, void 0, function* () {
          const DK = new Uint8Array(hashLength);
          const block1 = new Uint8Array(salt.length + 4);
          const block1View = new DataView(block1.buffer);
          const saltBuffer = getUInt8Buffer(salt);
          const saltUIntBuffer = new Uint8Array(saltBuffer.buffer, saltBuffer.byteOffset, saltBuffer.length);
          block1.set(saltUIntBuffer);
          let destPos = 0;
          const hLen = digest.digestSize;
          const l = Math.ceil(hashLength / hLen);
          let T = null;
          let U = null;
          for (let i = 1; i <= l; i++) {
            block1View.setUint32(salt.length, i);
            digest.init();
            digest.update(block1);
            T = digest.digest("binary");
            U = T.slice();
            for (let j = 1; j < iterations; j++) {
              digest.init();
              digest.update(U);
              U = digest.digest("binary");
              for (let k = 0; k < hLen; k++) {
                T[k] ^= U[k];
              }
            }
            DK.set(T.subarray(0, hashLength - destPos), destPos);
            destPos += hLen;
          }
          if (outputType === "binary") {
            return DK;
          }
          const digestChars = new Uint8Array(hashLength * 2);
          return getDigestHex(digestChars, DK, hashLength);
        });
      }
      const validateOptions$2 = (options) => {
        if (!options || typeof options !== "object") {
          throw new Error("Invalid options parameter. It requires an object.");
        }
        if (!options.hashFunction || !options.hashFunction.then) {
          throw new Error('Invalid hash function is provided! Usage: pbkdf2("password", "salt", 1000, 32, createSHA1()).');
        }
        if (!Number.isInteger(options.iterations) || options.iterations < 1) {
          throw new Error("Iterations should be a positive number");
        }
        if (!Number.isInteger(options.hashLength) || options.hashLength < 1) {
          throw new Error("Hash length should be a positive number");
        }
        if (options.outputType === void 0) {
          options.outputType = "hex";
        }
        if (!["hex", "binary"].includes(options.outputType)) {
          throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary']`);
        }
      };
      function pbkdf2(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateOptions$2(options);
          const hmac = yield createHMAC(options.hashFunction, options.password);
          return calculatePBKDF2(hmac, options.salt, options.iterations, options.hashLength, options.outputType);
        });
      }
      var name$3 = "scrypt";
      var data$3 = "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cyICajYCOCAAIAAoAjwgAiAKakESdyAGc2o2AjwLvxIDFX8Bfg5/AkAgAkUNACAAQQd0IgNBQGoiBEEAKAKACCIFIAMgAmwiBmogAyABbGoiByADaiIIaiEJIAAgAkEHdCIKIAFBB3RqIgtsIQwgACALQYABamwhDSAAQQV0IgtBASALQQFLGyILQWBxIQ4gC0EBcSEPIAdBeGohECAHQXBqIREgB0FoaiESIAdBYGohEyAHQVhqIRQgB0FQaiEVIAdBSGohFiAHQUBqIRcgAa1Cf3whGCAEIAdqIRkgByAAQQh0IhpqIRsgACAKQYABamwhHCALQQRJIR1BACEeQQAhHwNAQQAoAoAIIiAgAyAfbGohIQJAIABFDQBBACEiAkAgHQ0AICAgHmohI0EAIQtBACEiA0AgByALaiIEICMgC2oiJCgCADYCACAEQQRqICRBBGooAgA2AgAgBEEIaiAkQQhqKAIANgIAIARBDGogJEEMaigCADYCACALQRBqIQsgDiAiQQRqIiJHDQALCyAPRQ0AIAcgIkECdCILaiAhIAtqKAIANgIACwJAIAFFDQBBACElIBwhIyAGISYDQCAFISQgACEiAkACQCAADQAgGyAXKQMANwMAIBsgFikDADcDCCAbIBUpAwA3AxAgGyAUKQMANwMYIBsgEykDADcDICAbIBIpAwA3AyggGyARKQMANwMwIBsgECkDADcDOAwBCwNAICQgJmoiCyAkIAxqIgQpAwA3AwAgC0EIaiAEQQhqKQMANwMAIAtBEGogBEEQaikDADcDACALQRhqIARBGGopAwA3AwAgC0EgaiAEQSBqKQMANwMAIAtBKGogBEEoaikDADcDACALQTBqIARBMGopAwA3AwAgC0E4aiAEQThqKQMANwMAIAtBwABqIARBwABqKQMANwMAIAtByABqIARByABqKQMANwMAIAtB0ABqIARB0ABqKQMANwMAIAtB2ABqIARB2ABqKQMANwMAIAtB4ABqIARB4ABqKQMANwMAIAtB6ABqIARB6ABqKQMANwMAIAtB8ABqIARB8ABqKQMANwMAIAtB+ABqIARB+ABqKQMANwMAICRBgAFqISQgIkF/aiIiDQALIAcgCCAbIAAQAiAFISQgACEiA0AgJCAjaiILICQgDWoiBCkDADcDACALQQhqIARBCGopAwA3AwAgC0EQaiAEQRBqKQMANwMAIAtBGGogBEEYaikDADcDACALQSBqIARBIGopAwA3AwAgC0EoaiAEQShqKQMANwMAIAtBMGogBEEwaikDADcDACALQThqIARBOGopAwA3AwAgC0HAAGogBEHAAGopAwA3AwAgC0HIAGogBEHIAGopAwA3AwAgC0HQAGogBEHQAGopAwA3AwAgC0HYAGogBEHYAGopAwA3AwAgC0HgAGogBEHgAGopAwA3AwAgC0HoAGogBEHoAGopAwA3AwAgC0HwAGogBEHwAGopAwA3AwAgC0H4AGogBEH4AGopAwA3AwAgJEGAAWohJCAiQX9qIiINAAsLIAggByAbIAAQAiAjIBpqISMgJiAaaiEmICVBAmoiJSABSQ0AC0EAISUDQAJAAkAgAA0AIBsgFykDADcDACAbIBYpAwA3AwggGyAVKQMANwMQIBsgFCkDADcDGCAbIBMpAwA3AyAgGyASKQMANwMoIBsgESkDADcDMCAbIBApAwA3AzgMAQsgACAKIBkpAgAgGIOnQQd0amwhJiAFISQgACEiA0AgJCAMaiILIAspAwAgJCAmaiIEKQMAhTcDACALQQhqIiMgIykDACAEQQhqKQMAhTcDACALQRBqIiMgIykDACAEQRBqKQMAhTcDACALQRhqIiMgIykDACAEQRhqKQMAhTcDACALQSBqIiMgIykDACAEQSBqKQMAhTcDACALQShqIiMgIykDACAEQShqKQMAhTcDACALQTBqIiMgIykDACAEQTBqKQMAhTcDACALQThqIiMgIykDACAEQThqKQMAhTcDACALQcAAaiIjICMpAwAgBEHAAGopAwCFNwMAIAtByABqIiMgIykDACAEQcgAaikDAIU3AwAgC0HQAGoiIyAjKQMAIARB0ABqKQMAhTcDACALQdgAaiIjICMpAwAgBEHYAGopAwCFNwMAIAtB4ABqIiMgIykDACAEQeAAaikDAIU3AwAgC0HoAGoiIyAjKQMAIARB6ABqKQMAhTcDACALQfAAaiIjICMpAwAgBEHwAGopAwCFNwMAIAtB+ABqIgsgCykDACAEQfgAaikDAIU3AwAgJEGAAWohJCAiQX9qIiINAAsgByAIIBsgABACIAAgCiAJKQIAIBiDp0EHdGpsISYgBSEkIAAhIgNAICQgDWoiCyALKQMAICQgJmoiBCkDAIU3AwAgC0EIaiIjICMpAwAgBEEIaikDAIU3AwAgC0EQaiIjICMpAwAgBEEQaikDAIU3AwAgC0EYaiIjICMpAwAgBEEYaikDAIU3AwAgC0EgaiIjICMpAwAgBEEgaikDAIU3AwAgC0EoaiIjICMpAwAgBEEoaikDAIU3AwAgC0EwaiIjICMpAwAgBEEwaikDAIU3AwAgC0E4aiIjICMpAwAgBEE4aikDAIU3AwAgC0HAAGoiIyAjKQMAIARBwABqKQMAhTcDACALQcgAaiIjICMpAwAgBEHIAGopAwCFNwMAIAtB0ABqIiMgIykDACAEQdAAaikDAIU3AwAgC0HYAGoiIyAjKQMAIARB2ABqKQMAhTcDACALQeAAaiIjICMpAwAgBEHgAGopAwCFNwMAIAtB6ABqIiMgIykDACAEQegAaikDAIU3AwAgC0HwAGoiIyAjKQMAIARB8ABqKQMAhTcDACALQfgAaiILIAspAwAgBEH4AGopAwCFNwMAICRBgAFqISQgIkF/aiIiDQALCyAIIAcgGyAAEAIgJUECaiIlIAFJDQALCwJAIABFDQBBACEiAkAgHQ0AICAgHmohI0EAIQtBACEiA0AgIyALaiIEIAcgC2oiJCgCADYCACAEQQRqICRBBGooAgA2AgAgBEEIaiAkQQhqKAIANgIAIARBDGogJEEMaigCADYCACALQRBqIQsgDiAiQQRqIiJHDQALCyAPRQ0AICEgIkECdCILaiAHIAtqKAIANgIACyAeIANqIR4gH0EBaiIfIAJHDQALCws=";
      var hash$3 = "b32721f8";
      var wasmJson$3 = {
        name: name$3,
        data: data$3,
        hash: hash$3
      };
      function scryptInternal(options) {
        return __awaiter(this, void 0, void 0, function* () {
          const { costFactor, blockSize, parallelism, hashLength } = options;
          const SHA256Hasher = createSHA256();
          const blockData = yield pbkdf2({
            password: options.password,
            salt: options.salt,
            iterations: 1,
            hashLength: 128 * blockSize * parallelism,
            hashFunction: SHA256Hasher,
            outputType: "binary"
          });
          const scryptInterface = yield WASMInterface(wasmJson$3, 0);
          const VSize = 128 * blockSize * costFactor;
          const XYSize = 256 * blockSize;
          scryptInterface.setMemorySize(blockData.length + VSize + XYSize);
          scryptInterface.writeMemory(blockData, 0);
          scryptInterface.getExports().scrypt(blockSize, costFactor, parallelism);
          const expensiveSalt = scryptInterface.getMemory().subarray(0, 128 * blockSize * parallelism);
          const outputData = yield pbkdf2({
            password: options.password,
            salt: expensiveSalt,
            iterations: 1,
            hashLength,
            hashFunction: SHA256Hasher,
            outputType: "binary"
          });
          if (options.outputType === "hex") {
            const digestChars = new Uint8Array(hashLength * 2);
            return getDigestHex(digestChars, outputData, hashLength);
          }
          return outputData;
        });
      }
      const isPowerOfTwo = (v) => v && !(v & v - 1);
      const validateOptions$1 = (options) => {
        if (!options || typeof options !== "object") {
          throw new Error("Invalid options parameter. It requires an object.");
        }
        if (!Number.isInteger(options.blockSize) || options.blockSize < 1) {
          throw new Error("Block size should be a positive number");
        }
        if (!Number.isInteger(options.costFactor) || options.costFactor < 2 || !isPowerOfTwo(options.costFactor)) {
          throw new Error("Cost factor should be a power of 2, greater than 1");
        }
        if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
          throw new Error("Parallelism should be a positive number");
        }
        if (!Number.isInteger(options.hashLength) || options.hashLength < 1) {
          throw new Error("Hash length should be a positive number.");
        }
        if (options.outputType === void 0) {
          options.outputType = "hex";
        }
        if (!["hex", "binary"].includes(options.outputType)) {
          throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary']`);
        }
      };
      function scrypt(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateOptions$1(options);
          return scryptInternal(options);
        });
      }
      var name$2 = "bcrypt";
      var data$2 = "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";
      var hash$2 = "8bd8822d";
      var wasmJson$2 = {
        name: name$2,
        data: data$2,
        hash: hash$2
      };
      function bcryptInternal(options) {
        return __awaiter(this, void 0, void 0, function* () {
          const { costFactor, password, salt } = options;
          const bcryptInterface = yield WASMInterface(wasmJson$2, 0);
          bcryptInterface.writeMemory(getUInt8Buffer(salt), 0);
          const passwordBuffer = getUInt8Buffer(password);
          bcryptInterface.writeMemory(passwordBuffer, 16);
          const shouldEncode = options.outputType === "encoded" ? 1 : 0;
          bcryptInterface.getExports().bcrypt(passwordBuffer.length, costFactor, shouldEncode);
          const memory = bcryptInterface.getMemory();
          if (options.outputType === "encoded") {
            return intArrayToString(memory, 60);
          }
          if (options.outputType === "hex") {
            const digestChars = new Uint8Array(24 * 2);
            return getDigestHex(digestChars, memory, 24);
          }
          return memory.slice(0, 24);
        });
      }
      const validateOptions = (options) => {
        if (!options || typeof options !== "object") {
          throw new Error("Invalid options parameter. It requires an object.");
        }
        if (!Number.isInteger(options.costFactor) || options.costFactor < 4 || options.costFactor > 31) {
          throw new Error("Cost factor should be a number between 4 and 31");
        }
        options.password = getUInt8Buffer(options.password);
        if (options.password.length < 1) {
          throw new Error("Password should be at least 1 byte long");
        }
        if (options.password.length > 72) {
          throw new Error("Password should be at most 72 bytes long");
        }
        options.salt = getUInt8Buffer(options.salt);
        if (options.salt.length !== 16) {
          throw new Error("Salt should be 16 bytes long");
        }
        if (options.outputType === void 0) {
          options.outputType = "encoded";
        }
        if (!["hex", "binary", "encoded"].includes(options.outputType)) {
          throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
        }
      };
      function bcrypt(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateOptions(options);
          return bcryptInternal(options);
        });
      }
      const validateHashCharacters = (hash2) => {
        if (!/^\$2[axyb]\$[0-3][0-9]\$[./A-Za-z0-9]{53}$/.test(hash2)) {
          return false;
        }
        if (hash2[4] === "0" && Number(hash2[5]) < 4) {
          return false;
        }
        if (hash2[4] === "3" && Number(hash2[5]) > 1) {
          return false;
        }
        return true;
      };
      const validateVerifyOptions = (options) => {
        if (!options || typeof options !== "object") {
          throw new Error("Invalid options parameter. It requires an object.");
        }
        if (options.hash === void 0 || typeof options.hash !== "string") {
          throw new Error("Hash should be specified");
        }
        if (options.hash.length !== 60) {
          throw new Error("Hash should be 60 bytes long");
        }
        if (!validateHashCharacters(options.hash)) {
          throw new Error("Invalid hash");
        }
        options.password = getUInt8Buffer(options.password);
        if (options.password.length < 1) {
          throw new Error("Password should be at least 1 byte long");
        }
        if (options.password.length > 72) {
          throw new Error("Password should be at most 72 bytes long");
        }
      };
      function bcryptVerify(options) {
        return __awaiter(this, void 0, void 0, function* () {
          validateVerifyOptions(options);
          const { hash: hash2, password } = options;
          const bcryptInterface = yield WASMInterface(wasmJson$2, 0);
          bcryptInterface.writeMemory(getUInt8Buffer(hash2), 0);
          const passwordBuffer = getUInt8Buffer(password);
          bcryptInterface.writeMemory(passwordBuffer, 60);
          return !!bcryptInterface.getExports().bcrypt_verify(passwordBuffer.length);
        });
      }
      var name$1 = "whirlpool";
      var data$1 = "AGFzbQEAAAABEQRgAAF/YAF/AGACf38AYAAAAwkIAAECAwEDAAEFBAEBAgIGDgJ/AUHQmwULfwBBgAgLB3AIBm1lbW9yeQIADkhhc2hfR2V0QnVmZmVyAAAJSGFzaF9Jbml0AAMLSGFzaF9VcGRhdGUABApIYXNoX0ZpbmFsAAUNSGFzaF9HZXRTdGF0ZQAGDkhhc2hfQ2FsY3VsYXRlAAcKU1RBVEVfU0laRQMBCu0bCAUAQYAZC8wGAQl+IAApAwAhAUEAQQApA4CbASICNwPAmQEgACkDGCEDIAApAxAhBCAAKQMIIQVBAEEAKQOYmwEiBjcD2JkBQQBBACkDkJsBIgc3A9CZAUEAQQApA4ibASIINwPImQFBACABIAKFNwOAmgFBACAFIAiFNwOImgFBACAEIAeFNwOQmgFBACADIAaFNwOYmgEgACkDICEDQQBBACkDoJsBIgE3A+CZAUEAIAMgAYU3A6CaASAAKQMoIQRBAEEAKQOomwEiAzcD6JkBQQAgBCADhTcDqJoBIAApAzAhBUEAQQApA7CbASIENwPwmQFBACAFIASFNwOwmgEgACkDOCEJQQBBACkDuJsBIgU3A/iZAUEAIAkgBYU3A7iaAUEAQpjGmMb+kO6AzwA3A4CZAUHAmQFBgJkBEAJBgJoBQcCZARACQQBCtszKrp/v28jSADcDgJkBQcCZAUGAmQEQAkGAmgFBwJkBEAJBAELg+O70uJTDvTU3A4CZAUHAmQFBgJkBEAJBgJoBQcCZARACQQBCncDfluzlkv/XADcDgJkBQcCZAUGAmQEQAkGAmgFBwJkBEAJBAEKV7t2p/pO8pVo3A4CZAUHAmQFBgJkBEAJBgJoBQcCZARACQQBC2JKn0ZCW6LWFfzcDgJkBQcCZAUGAmQEQAkGAmgFBwJkBEAJBAEK9u8Ggv9nPgucANwOAmQFBwJkBQYCZARACQYCaAUHAmQEQAkEAQuTPhNr4tN/KWDcDgJkBQcCZAUGAmQEQAkGAmgFBwJkBEAJBAEL73fOz1vvFo55/NwOAmQFBwJkBQYCZARACQYCaAUHAmQEQAkEAQsrb/L3Q1dbBMzcDgJkBQcCZAUGAmQEQAkGAmgFBwJkBEAJBACACQQApA4CaASAAKQMAhYU3A4CbAUEAIAhBACkDiJoBIAApAwiFhTcDiJsBQQAgB0EAKQOQmgEgACkDEIWFNwOQmwFBACAGQQApA5iaASAAKQMYhYU3A5ibAUEAIAFBACkDoJoBIAApAyCFhTcDoJsBQQAgA0EAKQOomgEgACkDKIWFNwOomwFBACAEQQApA7CaASAAKQMwhYU3A7CbAUEAIAVBACkDuJoBIAApAziFhTcDuJsBC4YMCgF+AX8BfgF/AX4BfwF+AX8EfgN/IAAgACkDACICpyIDQf8BcUEDdEGQCGopAwBCOIkgACkDOCIEpyIFQQV2QfgPcUGQCGopAwCFQjiJIAApAzAiBqciB0ENdkH4D3FBkAhqKQMAhUI4iSAAKQMoIginIglBFXZB+A9xQZAIaikDAIVCOIkgACkDICIKQiCIp0H/AXFBA3RBkAhqKQMAhUI4iSAAKQMYIgtCKIinQf8BcUEDdEGQCGopAwCFQjiJIAApAxAiDEIwiKdB/wFxQQN0QZAIaikDAIVCOIkgACkDCCINQjiIp0EDdEGQCGopAwCFQjiJIAEpAwCFNwMAIAAgDaciDkH/AXFBA3RBkAhqKQMAQjiJIANBBXZB+A9xQZAIaikDAIVCOIkgBUENdkH4D3FBkAhqKQMAhUI4iSAHQRV2QfgPcUGQCGopAwCFQjiJIAhCIIinQf8BcUEDdEGQCGopAwCFQjiJIApCKIinQf8BcUEDdEGQCGopAwCFQjiJIAtCMIinQf8BcUEDdEGQCGopAwCFQjiJIAxCOIinQQN0QZAIaikDAIVCOIkgASkDCIU3AwggACAMpyIPQf8BcUEDdEGQCGopAwBCOIkgDkEFdkH4D3FBkAhqKQMAhUI4iSADQQ12QfgPcUGQCGopAwCFQjiJIAVBFXZB+A9xQZAIaikDAIVCOIkgBkIgiKdB/wFxQQN0QZAIaikDAIVCOIkgCEIoiKdB/wFxQQN0QZAIaikDAIVCOIkgCkIwiKdB/wFxQQN0QZAIaikDAIVCOIkgC0I4iKdBA3RBkAhqKQMAhUI4iSABKQMQhTcDECAAIAunIhBB/wFxQQN0QZAIaikDAEI4iSAPQQV2QfgPcUGQCGopAwCFQjiJIA5BDXZB+A9xQZAIaikDAIVCOIkgA0EVdkH4D3FBkAhqKQMAhUI4iSAEQiCIp0H/AXFBA3RBkAhqKQMAhUI4iSAGQiiIp0H/AXFBA3RBkAhqKQMAhUI4iSAIQjCIp0H/AXFBA3RBkAhqKQMAhUI4iSAKQjiIp0EDdEGQCGopAwCFQjiJIAEpAxiFNwMYIAAgCqciA0H/AXFBA3RBkAhqKQMAQjiJIBBBBXZB+A9xQZAIaikDAIVCOIkgD0ENdkH4D3FBkAhqKQMAhUI4iSAOQRV2QfgPcUGQCGopAwCFQjiJIAJCIIinQf8BcUEDdEGQCGopAwCFQjiJIARCKIinQf8BcUEDdEGQCGopAwCFQjiJIAZCMIinQf8BcUEDdEGQCGopAwCFQjiJIAhCOIinQQN0QZAIaikDAIVCOIkgASkDIIU3AyAgACAJQf8BcUEDdEGQCGopAwBCOIkgA0EFdkH4D3FBkAhqKQMAhUI4iSAQQQ12QfgPcUGQCGopAwCFQjiJIA9BFXZB+A9xQZAIaikDAIVCOIkgDUIgiKdB/wFxQQN0QZAIaikDAIVCOIkgAkIoiKdB/wFxQQN0QZAIaikDAIVCOIkgBEIwiKdB/wFxQQN0QZAIaikDAIVCOIkgBkI4iKdBA3RBkAhqKQMAhUI4iSABKQMohTcDKCAAIAdB/wFxQQN0QZAIaikDAEI4iSAJQQV2QfgPcUGQCGopAwCFQjiJIANBDXZB+A9xQZAIaikDAIVCOIkgEEEVdkH4D3FBkAhqKQMAhUI4iSAMQiCIp0H/AXFBA3RBkAhqKQMAhUI4iSANQiiIp0H/AXFBA3RBkAhqKQMAhUI4iSACQjCIp0H/AXFBA3RBkAhqKQMAhUI4iSAEQjiIp0EDdEGQCGopAwCFQjiJIAEpAzCFNwMwIAAgBUH/AXFBA3RBkAhqKQMAQjiJIAdBBXZB+A9xQZAIaikDAIVCOIkgCUENdkH4D3FBkAhqKQMAhUI4iSADQRV2QfgPcUGQCGopAwCFQjiJIAtCIIinQf8BcUEDdEGQCGopAwCFQjiJIAxCKIinQf8BcUEDdEGQCGopAwCFQjiJIA1CMIinQf8BcUEDdEGQCGopAwCFQjiJIAJCOIinQQN0QZAIaikDAIVCOIkgASkDOIU3AzgLXABBAEIANwPImwFBAEIANwO4mwFBAEIANwOwmwFBAEIANwOomwFBAEIANwOgmwFBAEIANwOYmwFBAEIANwOQmwFBAEIANwOImwFBAEIANwOAmwFBAEEANgLAmwELxgMBB39BACEBQQBBACkDyJsBIACtfDcDyJsBAkBBACgCwJsBIgJFDQBBACEBAkAgAiAAaiIDQcAAIANBwABJGyIEIAJB/wFxIgVNDQAgBCAFayIBQQNxIQYCQAJAIAQgBUF/c2pBA08NAEEAIQEMAQsgAUF8cSEHQQAhAQNAIAUgAWoiAkHAmgFqIAFBgBlqLQAAOgAAIAJBwZoBaiABQYEZai0AADoAACACQcKaAWogAUGCGWotAAA6AAAgAkHDmgFqIAFBgxlqLQAAOgAAIAcgAUEEaiIBRw0ACyAFIAFqIgUhAgsgBkUNACACQf8BcUEBaiECA0AgBUHAmgFqIAFBgBlqLQAAOgAAIAIiBUEBaiECIAFBAWohASAFIQUgBkF/aiIGDQALCwJAIANBP00NAEHAmgEQAUEAIQQLQQAgBDYCwJsBCwJAIAAgAWsiAkHAAEkNAANAIAFBgBlqEAEgAUHAAGohASACQUBqIgJBP0sNAAsLAkAgASAARg0AQQAgAjYCwJsBIAJFDQBBACECQQAhBQNAIAJBwJoBaiACIAFqQYAZai0AADoAAEEAKALAmwEgBUEBaiIFQf8BcSICSw0ACwsL/wMCBH8BfiMAQcAAayIAJAAgAEE4akIANwMAIABBMGpCADcDACAAQShqQgA3AwAgAEEgakIANwMAIABBGGpCADcDACAAQRBqQgA3AwAgAEIANwMIIABCADcDAEEAIQECQAJAQQAoAsCbASICRQ0AQQAhAwNAIAAgAWogAUHAmgFqLQAAOgAAIAFBAWohASACIANBAWoiA0H/AXFLDQALQQAgAkEBajYCwJsBIAAgAmpBgAE6AAAgAkFgcUEgRw0BIAAQASAAQgA3AxggAEIANwMQIABCADcDCCAAQgA3AwAMAQtBAEEBNgLAmwEgAEGAAToAAAtBACkDyJsBIQRBAEIANwPImwEgAEEAOgA2IABBADYBMiAAQgA3ASogAEEAOgApIABCADcAISAAQQA6ACAgACAEQgWIPAA+IAAgBEINiDwAPSAAIARCFYg8ADwgACAEQh2IPAA7IAAgBEIliDwAOiAAIARCLYg8ADkgACAEQjWIPAA4IAAgBEI9iDwANyAAIASnQQN0OgA/IAAQAUEAQQApA4CbATcDgBlBAEEAKQOImwE3A4gZQQBBACkDkJsBNwOQGUEAQQApA5ibATcDmBlBAEEAKQOgmwE3A6AZQQBBACkDqJsBNwOoGUEAQQApA7CbATcDsBlBAEEAKQO4mwE3A7gZIABBwABqJAALBgBBwJoBC2IAQQBCADcDyJsBQQBCADcDuJsBQQBCADcDsJsBQQBCADcDqJsBQQBCADcDoJsBQQBCADcDmJsBQQBCADcDkJsBQQBCADcDiJsBQQBCADcDgJsBQQBBADYCwJsBIAAQBBAFCwuYEAEAQYAIC5AQkAAAAAAAAAAAAAAAAAAAABgYYBjAeDDYIyOMIwWvRibGxj/GfvmRuOjoh+gTb837h4cmh0yhE8u4uNq4qWJtEQEBBAEIBQIJT08hT0Jung02Ntg2re5sm6amoqZZBFH/0tJv0t69uQz19fP1+wb3Dnl5+XnvgPKWb2+hb1/O3jCRkX6R/O8/bVJSVVKqB6T4YGCdYCf9wEe8vMq8iXZlNZubVpuszSs3jo4CjgSMAYqjo7ajcRVb0gwMMAxgPBhse3vxe/+K9oQ1NdQ1teFqgB0ddB3oaTr14OCn4FNH3bPX13vX9qyzIcLCL8Je7ZmcLi64Lm2WXENLSzFLYnqWKf7+3/6jIeFdV1dBV4IWrtUVFVQVqEEqvXd3wXeftu7oNzfcN6XrbpLl5bPle1bXnp+fRp+M2SMT8PDn8NMX/SNKSjVKan+UINraT9qelalEWFh9WPolsKLJyQPJBsqPzykppClVjVJ8CgooClAiFFqxsf6x4U9/UKCguqBpGl3Ja2uxa3/a1hSFhS6FXKsX2b29zr2Bc2c8XV1pXdI0uo8QEEAQgFAgkPT09/TzA/UHy8sLyxbAi90+Pvg+7cZ80wUFFAUoEQotZ2eBZx/mznjk5Lfkc1PVlycnnCclu04CQUEZQTJYgnOLixaLLJ0Lp6enpqdRAVP2fX3pfc+U+rKVlW6V3Ps3SdjYR9iOn61W+/vL+4sw63Du7p/uI3HBzXx87XzHkfi7ZmaFZhfjzHHd3VPdpo6nexcXXBe4Sy6vR0cBRwJGjkWenkKehNwhGsrKD8oexYnULS20LXWZWli/v8a/kXljLgcHHAc4Gw4/ra2OrQEjR6xaWnVa6i+0sIODNoNstRvvMzPMM4X/ZrZjY5FjP/LGXAICCAIQCgQSqqqSqjk4SZNxcdlxr6ji3sjIB8gOz43GGRlkGch9MtFJSTlJcnCSO9nZQ9mGmq9f8vLv8sMd+THj46vjS0jbqFtbcVviKra5iIgaiDSSDbyamlKapMgpPiYmmCYtvkwLMjLIMo36ZL+wsPqw6Up9Wenpg+kbas/yDw88D3gzHnfV1XPV5qa3M4CAOoB0uh30vr7Cvpl8YSfNzRPNJt6H6zQ00DS95GiJSEg9SHp1kDL//9v/qyTjVHp69Xr3j/SNkJB6kPTqPWRfX2Ffwj6+nSAggCAdoEA9aGi9aGfV0A8aGmga0HI0yq6ugq4ZLEG3tLTqtMledX1UVE1UmhmozpOTdpPs5Tt/IiKIIg2qRC9kZI1kB+nIY/Hx4/HbEv8qc3PRc7+i5swSEkgSkFokgkBAHUA6XYB6CAggCEAoEEjDwyvDVuiblezsl+wze8Xf29tL25aQq02hob6hYR9fwI2NDo0cgweRPT30PfXJesiXl2aXzPEzWwAAAAAAAAAAz88bzzbUg/krK6wrRYdWbnZ2xXaXs+zhgoIygmSwGebW1n/W/qmxKBsbbBvYdzbDtbXutcFbd3Svr4avESlDvmpqtWp339QdUFBdULoNoOpFRQlFEkyKV/Pz6/PLGPs4MDDAMJ3wYK3v75vvK3TDxD8//D/lw37aVVVJVZIcqseiorKieRBZ2+rqj+oDZcnpZWWJZQ/symq6utK6uWhpAy8vvC9lk15KwMAnwE7nnY7e3l/evoGhYBwccBzgbDj8/f3T/bsu50ZNTSlNUmSaH5KScpLk4Dl2dXXJdY+86voGBhgGMB4MNoqKEookmAmusrLysvlAeUvm5r/mY1nRhQ4OOA5wNhx+Hx98H/hjPudiYpViN/fEVdTUd9Tuo7U6qKiaqCkyTYGWlmKWxPQxUvn5w/mbOu9ixcUzxWb2l6MlJZQlNbFKEFlZeVnyILKrhIQqhFSuFdByctVyt6fkxTk55DnV3XLsTEwtTFphmBZeXmVeyju8lHh4/XjnhfCfODjgON3YcOWMjAqMFIYFmNHRY9HGsr8XpaWupUELV+Ti4q/iQ03ZoWFhmWEv+MJOs7P2s/FFe0IhIYQhFaVCNJycSpyU1iUIHh54HvBmPO5DQxFDIlKGYcfHO8d2/JOx/PzX/LMr5U8EBBAEIBQIJFFRWVGyCKLjmZlembzHLyVtbaltT8TaIg0NNA1oORpl+vrP+oM16Xnf31vftoSjaX5+5X7Xm/ypJCSQJD20SBk7O+w7xdd2/qurlqsxPUuazs4fzj7RgfAREUQRiFUimY+PBo8MiQODTk4lTkprnAS3t+a30VFzZuvri+sLYMvgPDzwPP3MeMGBgT6BfL8f/ZSUapTU/jVA9/f79+sM8xy5ud65oWdvGBMTTBOYXyaLLCywLH2cWFHT02vT1ri7Befnu+drXNOMbm6lblfL3DnExDfEbvOVqgMDDAMYDwYbVlZFVooTrNxERA1EGkmIXn9/4X/fnv6gqameqSE3T4gqKqgqTYJUZ7u71ruxbWsKwcEjwUbin4dTU1FTogKm8dzcV9yui6VyCwssC1gnFlOdnU6dnNMnAWxsrWxHwdgrMTHEMZX1YqR0dM10h7no8/b2//bjCfEVRkYFRgpDjEysrIqsCSZFpYmJHok8lw+1FBRQFKBEKLTh4aPhW0LfuhYWWBawTiymOjroOs3SdPdpablpb9DSBgkJJAlILRJBcHDdcKet4Ne2tuK22VRxb9DQZ9DOt70e7e2T7Tt+x9bMzBfMLtuF4kJCFUIqV4RomJhamLTCLSykpKqkSQ5V7SgooChdiFB1XFxtXNoxuIb4+Mf4kz/ta4aGIoZEpBHC";
      var hash$1 = "8d8f6035";
      var wasmJson$1 = {
        name: name$1,
        data: data$1,
        hash: hash$1
      };
      const mutex$1 = new Mutex();
      let wasmCache$1 = null;
      function whirlpool(data2) {
        if (wasmCache$1 === null) {
          return lockedCreate(mutex$1, wasmJson$1, 64).then((wasm) => {
            wasmCache$1 = wasm;
            return wasmCache$1.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache$1.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createWhirlpool() {
        return WASMInterface(wasmJson$1, 64).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 64
          };
          return obj;
        });
      }
      var name = "sm3";
      var data = "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";
      var hash = "b6fb4b8e";
      var wasmJson = {
        name,
        data,
        hash
      };
      const mutex = new Mutex();
      let wasmCache = null;
      function sm3(data2) {
        if (wasmCache === null) {
          return lockedCreate(mutex, wasmJson, 32).then((wasm) => {
            wasmCache = wasm;
            return wasmCache.calculate(data2);
          });
        }
        try {
          const hash2 = wasmCache.calculate(data2);
          return Promise.resolve(hash2);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      function createSM3() {
        return WASMInterface(wasmJson, 32).then((wasm) => {
          wasm.init();
          const obj = {
            init: () => {
              wasm.init();
              return obj;
            },
            update: (data2) => {
              wasm.update(data2);
              return obj;
            },
            // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
            digest: (outputType) => wasm.digest(outputType),
            save: () => wasm.save(),
            load: (data2) => {
              wasm.load(data2);
              return obj;
            },
            blockSize: 64,
            digestSize: 32
          };
          return obj;
        });
      }
      exports2.adler32 = adler32;
      exports2.argon2Verify = argon2Verify2;
      exports2.argon2d = argon2d;
      exports2.argon2i = argon2i;
      exports2.argon2id = argon2id2;
      exports2.bcrypt = bcrypt;
      exports2.bcryptVerify = bcryptVerify;
      exports2.blake2b = blake2b;
      exports2.blake2s = blake2s;
      exports2.blake3 = blake3;
      exports2.crc32 = crc32;
      exports2.crc64 = crc64;
      exports2.createAdler32 = createAdler32;
      exports2.createBLAKE2b = createBLAKE2b;
      exports2.createBLAKE2s = createBLAKE2s;
      exports2.createBLAKE3 = createBLAKE3;
      exports2.createCRC32 = createCRC32;
      exports2.createCRC64 = createCRC64;
      exports2.createHMAC = createHMAC;
      exports2.createKeccak = createKeccak;
      exports2.createMD4 = createMD4;
      exports2.createMD5 = createMD5;
      exports2.createRIPEMD160 = createRIPEMD160;
      exports2.createSHA1 = createSHA1;
      exports2.createSHA224 = createSHA224;
      exports2.createSHA256 = createSHA256;
      exports2.createSHA3 = createSHA3;
      exports2.createSHA384 = createSHA384;
      exports2.createSHA512 = createSHA512;
      exports2.createSM3 = createSM3;
      exports2.createWhirlpool = createWhirlpool;
      exports2.createXXHash128 = createXXHash128;
      exports2.createXXHash3 = createXXHash3;
      exports2.createXXHash32 = createXXHash32;
      exports2.createXXHash64 = createXXHash64;
      exports2.keccak = keccak;
      exports2.md4 = md4;
      exports2.md5 = md5;
      exports2.pbkdf2 = pbkdf2;
      exports2.ripemd160 = ripemd160;
      exports2.scrypt = scrypt;
      exports2.sha1 = sha1;
      exports2.sha224 = sha224;
      exports2.sha256 = sha256;
      exports2.sha3 = sha3;
      exports2.sha384 = sha384;
      exports2.sha512 = sha512;
      exports2.sm3 = sm3;
      exports2.whirlpool = whirlpool;
      exports2.xxhash128 = xxhash128;
      exports2.xxhash3 = xxhash3;
      exports2.xxhash32 = xxhash32;
      exports2.xxhash64 = xxhash64;
    }));
  }
});

// src/hub/edge/terminal-pin.ts
var terminal_pin_exports = {};
__export(terminal_pin_exports, {
  TERMINAL_PIN_ARGON2: () => TERMINAL_PIN_ARGON2,
  TERMINAL_PIN_FAILURE_LIMIT: () => TERMINAL_PIN_FAILURE_LIMIT,
  TERMINAL_PIN_FAILURE_WINDOW_MINUTES: () => TERMINAL_PIN_FAILURE_WINDOW_MINUTES,
  TERMINAL_PIN_LOCK_MINUTES: () => TERMINAL_PIN_LOCK_MINUTES,
  TERMINAL_PIN_PATTERN: () => TERMINAL_PIN_PATTERN,
  TERMINAL_PIN_SESSION_HOURS: () => TERMINAL_PIN_SESSION_HOURS,
  changeTerminalPin: () => changeTerminalPin,
  lockTerminalSession: () => lockTerminalSession,
  readTerminalPinStatus: () => readTerminalPinStatus,
  resetTerminalPin: () => resetTerminalPin,
  setupTerminalPin: () => setupTerminalPin,
  terminalPinVerifier: () => terminalPinVerifier,
  unlockTerminalWithPin: () => unlockTerminalWithPin,
  verifyTerminalPin: () => verifyTerminalPin
});
import { createHash as createHash7, randomBytes as randomBytes3, randomUUID as randomUUID6 } from "node:crypto";
async function terminalPinVerifier(pin, salt = randomBytes3(TERMINAL_PIN_ARGON2.saltLength)) {
  if (!TERMINAL_PIN_PATTERN.test(pin)) {
    throw new Error("KLUY-TERMINAL-PIN-FORMAT: a Terminal PIN is exactly four digits");
  }
  return (0, import_hash_wasm.argon2id)({
    password: pin,
    salt,
    parallelism: TERMINAL_PIN_ARGON2.parallelism,
    iterations: TERMINAL_PIN_ARGON2.iterations,
    memorySize: TERMINAL_PIN_ARGON2.memorySize,
    hashLength: TERMINAL_PIN_ARGON2.hashLength,
    outputType: "encoded"
  });
}
async function verifyTerminalPin(pin, verifier) {
  if (!TERMINAL_PIN_PATTERN.test(pin) || !VERIFIER_PATTERN.test(verifier)) return false;
  try {
    return await (0, import_hash_wasm.argon2Verify)({ password: pin, hash: verifier });
  } catch {
    return false;
  }
}
async function lockTerminal(client, terminalDeviceId) {
  const result = await client.query(
    `select id, tenant_id, digital_store_id, location_id
       from edge_identity.terminal_device where id = $1::uuid for update`,
    [terminalDeviceId]
  );
  return result.rows[0] ?? null;
}
async function readPinRow(client, terminalDeviceId) {
  const result = await client.query(
    `select state, verifier, pin_version, set_at, failed_attempts, first_failed_at, locked_until
       from edge_identity.terminal_pin where terminal_device_id = $1::uuid`,
    [terminalDeviceId]
  );
  return result.rows[0] ?? null;
}
async function hubNow(client) {
  const result = await client.query(`select now() as now`);
  const row = result.rows[0];
  if (row === void 0) throw new Error("the Hub database returned no transaction time");
  return row.now;
}
function windowExpired(row, now) {
  return row.first_failed_at !== null && now.getTime() - row.first_failed_at.getTime() >= WINDOW_MS;
}
function statusOf(row, now) {
  if (row === null) {
    return {
      state: "setup_required",
      pinVersion: 0,
      setAt: null,
      lockedUntil: null,
      attemptsBeforeLock: TERMINAL_PIN_FAILURE_LIMIT
    };
  }
  const locked = row.locked_until !== null && row.locked_until.getTime() > now.getTime();
  const counted = windowExpired(row, now) ? 0 : row.failed_attempts;
  return {
    state: row.state,
    pinVersion: row.pin_version,
    setAt: row.set_at === null ? null : row.set_at.toISOString(),
    lockedUntil: locked && row.locked_until !== null ? row.locked_until.toISOString() : null,
    attemptsBeforeLock: locked ? 0 : Math.max(0, TERMINAL_PIN_FAILURE_LIMIT - counted)
  };
}
async function hubDeviceId(client) {
  const { rows } = await client.query(
    `select hub_device_id from edge_identity.hub_assignment
      where ended_at is null order by assignment_generation desc limit 1`
  );
  const row = rows[0];
  if (row === void 0) throw new Error("the Store Hub has no live assignment to record against");
  return row.hub_device_id;
}
async function audit(client, terminal, input) {
  const payload = JSON.stringify(input.details);
  await appendAuditEvent(client, {
    id: randomUUID6(),
    tenantId: terminal.tenant_id,
    digitalStoreId: terminal.digital_store_id,
    locationId: terminal.location_id,
    eventCode: input.eventCode,
    actorType: input.actorType,
    actorId: input.actorType === "terminal_device" ? terminal.id : null,
    requesterId: null,
    approverId: null,
    terminalDeviceId: terminal.id,
    hubDeviceId: await hubDeviceId(client),
    profileCode: T1_PROFILE_CODE,
    resourceType: "terminal_pin",
    resourceId: terminal.id,
    reasonCode: input.reasonCode,
    correlationId: input.correlationId,
    payloadSha256: createHash7("sha256").update(payload, "utf8").digest("hex"),
    details: input.details,
    localSequence: await allocateHubSequence(client)
  });
}
async function security(client, terminal, eventCode, severity, details) {
  await recordSecurityEvent(client, {
    id: randomUUID6(),
    tenantId: terminal.tenant_id,
    digitalStoreId: terminal.digital_store_id,
    locationId: terminal.location_id,
    eventCode,
    severity,
    deviceId: terminal.id,
    certificateSerial: null,
    details
  });
}
async function openPinSession(client, terminal, now) {
  const previous = await client.query(
    `select coalesce(max(session_generation), 0)::int as generation
       from edge_identity.terminal_session
      where terminal_device_id = $1::uuid and profile_code = $2`,
    [terminal.id, T1_PROFILE_CODE]
  );
  await client.query(
    `update edge_identity.terminal_session
        set closed_at = now(), status = 'superseded'
      where terminal_device_id = $1::uuid and profile_code = $2 and closed_at is null`,
    [terminal.id, T1_PROFILE_CODE]
  );
  const sessionId = randomUUID6();
  const generation = (previous.rows[0]?.generation ?? 0) + 1;
  const expiresAt = new Date(now.getTime() + TERMINAL_PIN_SESSION_HOURS * 36e5);
  await client.query(
    `insert into edge_identity.terminal_session
       (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
        profile_code, opened_at, expires_at, closed_at, session_generation,
        last_event_sequence, status, credential_kind)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $5::uuid,
             $6, $7, $8, null, $9, 0, 'open', 'terminal_pin')`,
    [
      sessionId,
      terminal.tenant_id,
      terminal.digital_store_id,
      terminal.location_id,
      terminal.id,
      T1_PROFILE_CODE,
      now,
      expiresAt,
      generation
    ]
  );
  return {
    sessionId,
    actorId: terminal.id,
    displayName: "",
    profileCode: T1_PROFILE_CODE,
    openedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sessionGeneration: generation,
    effectivePermissions: [...T1_TERMINAL_PIN_PERMISSIONS],
    authorityTime: now.toISOString(),
    credentialKind: "terminal_pin"
  };
}
async function readTerminalPinStatus(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const now = await hubNow(client);
      const pin = statusOf(await readPinRow(client, input.terminalDeviceId), now);
      let session = null;
      if (input.sessionId !== null) {
        const found = await client.query(
          `select closed_at, expires_at, credential_kind from edge_identity.terminal_session
            where id = $1::uuid and terminal_device_id = $2::uuid`,
          [input.sessionId, input.terminalDeviceId]
        );
        const row = found.rows[0];
        session = row === void 0 || row.credential_kind !== "terminal_pin" ? { state: "unknown", expiresAt: null } : row.closed_at !== null ? { state: "closed", expiresAt: row.expires_at.toISOString() } : row.expires_at.getTime() <= now.getTime() ? { state: "expired", expiresAt: row.expires_at.toISOString() } : { state: "open", expiresAt: row.expires_at.toISOString() };
      }
      return { pin, session, authorityTime: now.toISOString() };
    },
    HUB_RUNTIME_ROLE
  );
}
function formatRefusal(detail) {
  return { outcome: "refused", refusal: "PIN_FORMAT_INVALID", detail };
}
async function setupTerminalPin(pool, input) {
  if (!TERMINAL_PIN_PATTERN.test(input.pin) || !TERMINAL_PIN_PATTERN.test(input.pinConfirmation)) {
    return formatRefusal("a Terminal PIN is exactly four digits");
  }
  if (input.pin !== input.pinConfirmation) {
    return {
      outcome: "refused",
      refusal: "PIN_CONFIRMATION_MISMATCH",
      detail: "the two entries differ; enter the new PIN twice"
    };
  }
  const verifier = await terminalPinVerifier(input.pin);
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const now = await hubNow(client);
      const row = await readPinRow(client, terminal.id);
      if (row !== null && row.state === "set") {
        return {
          outcome: "refused",
          refusal: "PIN_ALREADY_SET",
          detail: "this terminal already has a PIN; change it, or have it reset",
          status: statusOf(row, now)
        };
      }
      const version = (row?.pin_version ?? 0) + 1;
      await client.query(
        `insert into edge_identity.terminal_pin
           (terminal_device_id, tenant_id, digital_store_id, location_id, state, verifier,
            pin_version, set_at, failed_attempts, first_failed_at, locked_until,
            last_unlocked_at, updated_at)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'set', $5, $6, now(), 0, null, null,
                 now(), now())
         on conflict (terminal_device_id) do update
            set state = 'set', verifier = excluded.verifier, pin_version = excluded.pin_version,
                set_at = now(), failed_attempts = 0, first_failed_at = null,
                locked_until = null, last_unlocked_at = now(), updated_at = now()`,
        [
          terminal.id,
          terminal.tenant_id,
          terminal.digital_store_id,
          terminal.location_id,
          verifier,
          version
        ]
      );
      await audit(client, terminal, {
        eventCode: "terminal_pin.established",
        actorType: "terminal_device",
        reasonCode: row === null ? "first_setup" : "after_reset",
        correlationId: input.correlationId,
        details: { pinVersion: version }
      });
      const session = await openPinSession(client, terminal, now);
      const after = await readPinRow(client, terminal.id);
      return {
        outcome: "ok",
        result: "PIN_ESTABLISHED",
        value: { session, pin: statusOf(after, now) }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
async function attempt(client, terminal, pin) {
  const now = await hubNow(client);
  const row = await readPinRow(client, terminal.id);
  if (row === null || row.state !== "set" || row.verifier === null) {
    return {
      verified: false,
      result: {
        outcome: "refused",
        refusal: "PIN_SETUP_REQUIRED",
        detail: "this terminal has no PIN yet; create one",
        status: statusOf(row, now)
      }
    };
  }
  if (row.locked_until !== null && row.locked_until.getTime() > now.getTime()) {
    await security(client, terminal, "TERMINAL_PIN_ATTEMPT_WHILE_LOCKED", "medium", {
      pinVersion: row.pin_version
    });
    return {
      verified: false,
      result: {
        outcome: "refused",
        refusal: "PIN_LOCKED",
        detail: "too many incorrect PINs; wait until the lock ends",
        status: statusOf(row, now)
      }
    };
  }
  if (await verifyTerminalPin(pin, row.verifier)) {
    await client.query(
      `update edge_identity.terminal_pin
          set failed_attempts = 0, first_failed_at = null, locked_until = null,
              last_unlocked_at = now(), updated_at = now()
        where terminal_device_id = $1::uuid`,
      [terminal.id]
    );
    const fresh = await readPinRow(client, terminal.id);
    return { verified: true, row: fresh ?? row, now };
  }
  const counted = (windowExpired(row, now) || row.first_failed_at === null ? 0 : row.failed_attempts) + 1;
  if (counted >= TERMINAL_PIN_FAILURE_LIMIT) {
    await client.query(
      `update edge_identity.terminal_pin
          set failed_attempts = 0, first_failed_at = null,
              locked_until = now() + make_interval(mins => $2::int), updated_at = now()
        where terminal_device_id = $1::uuid`,
      [terminal.id, TERMINAL_PIN_LOCK_MINUTES]
    );
    await security(client, terminal, "TERMINAL_PIN_LOCKED", "high", {
      pinVersion: row.pin_version,
      failures: counted,
      lockMinutes: TERMINAL_PIN_LOCK_MINUTES
    });
  } else {
    await client.query(
      `update edge_identity.terminal_pin
          set failed_attempts = $2::int,
              first_failed_at = case when $2::int = 1 then now() else first_failed_at end,
              locked_until = null, updated_at = now()
        where terminal_device_id = $1::uuid`,
      [terminal.id, counted]
    );
    await security(client, terminal, "TERMINAL_PIN_INCORRECT", "low", {
      pinVersion: row.pin_version,
      failures: counted
    });
  }
  const after = await readPinRow(client, terminal.id);
  const status = statusOf(after, now);
  return {
    verified: false,
    result: status.lockedUntil !== null ? {
      outcome: "refused",
      refusal: "PIN_LOCKED",
      detail: "too many incorrect PINs; the Terminal PIN is locked",
      status
    } : {
      outcome: "refused",
      refusal: "PIN_INCORRECT",
      detail: "the PIN is not correct",
      status
    }
  };
}
async function unlockTerminalWithPin(pool, input) {
  if (!TERMINAL_PIN_PATTERN.test(input.pin)) {
    return formatRefusal("a Terminal PIN is exactly four digits");
  }
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const verdict = await attempt(client, terminal, input.pin);
      if (!verdict.verified) return verdict.result;
      await audit(client, terminal, {
        eventCode: "terminal_pin.unlocked",
        actorType: "terminal_device",
        reasonCode: null,
        correlationId: input.correlationId,
        details: { pinVersion: verdict.row.pin_version }
      });
      const session = await openPinSession(client, terminal, verdict.now);
      return {
        outcome: "ok",
        result: "TERMINAL_UNLOCKED",
        value: { session, pin: statusOf(verdict.row, verdict.now) }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
async function changeTerminalPin(pool, input) {
  if (!TERMINAL_PIN_PATTERN.test(input.currentPin) || !TERMINAL_PIN_PATTERN.test(input.newPin) || !TERMINAL_PIN_PATTERN.test(input.newPinConfirmation)) {
    return formatRefusal("a Terminal PIN is exactly four digits");
  }
  if (input.newPin !== input.newPinConfirmation) {
    return {
      outcome: "refused",
      refusal: "PIN_CONFIRMATION_MISMATCH",
      detail: "the two entries of the new PIN differ"
    };
  }
  const verifier = await terminalPinVerifier(input.newPin);
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const verdict = await attempt(client, terminal, input.currentPin);
      if (!verdict.verified) return verdict.result;
      const version = verdict.row.pin_version + 1;
      await client.query(
        `update edge_identity.terminal_pin
            set verifier = $2, pin_version = $3, set_at = now(), updated_at = now()
          where terminal_device_id = $1::uuid`,
        [terminal.id, verifier, version]
      );
      await audit(client, terminal, {
        eventCode: "terminal_pin.changed",
        actorType: "terminal_device",
        reasonCode: null,
        correlationId: input.correlationId,
        details: { pinVersion: version }
      });
      const after = await readPinRow(client, terminal.id);
      return { outcome: "ok", result: "PIN_CHANGED", value: { pin: statusOf(after, verdict.now) } };
    },
    HUB_RUNTIME_ROLE
  );
}
async function lockTerminalSession(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const found = await client.query(
        `select closed_at, credential_kind from edge_identity.terminal_session
          where id = $1::uuid and terminal_device_id = $2::uuid for update`,
        [input.sessionId, input.terminalDeviceId]
      );
      const row = found.rows[0];
      if (row === void 0 || row.credential_kind !== "terminal_pin") {
        return { outcome: "refused", refusal: "SESSION_UNKNOWN", detail: "no such session" };
      }
      if (row.closed_at !== null) {
        return { outcome: "refused", refusal: "SESSION_CLOSED", detail: "the session is closed" };
      }
      await client.query(
        `update edge_identity.terminal_session set closed_at = now(), status = 'locked'
          where id = $1::uuid`,
        [input.sessionId]
      );
      return { outcome: "ok", result: "TERMINAL_LOCKED", value: { sessionId: input.sessionId } };
    },
    HUB_RUNTIME_ROLE
  );
}
async function resetTerminalPin(pool, input) {
  if (!/^[A-Za-z0-9_.:-]{3,64}$/u.test(input.actorRef) || !/^[a-z0-9_]{3,48}$/u.test(input.reasonCode)) {
    return {
      outcome: "refused",
      refusal: "PIN_FORMAT_INVALID",
      detail: "an operator reference and a snake_case reason code are required"
    };
  }
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const now = await hubNow(client);
      const row = await readPinRow(client, terminal.id);
      if (row === null || row.state !== "set") {
        return {
          outcome: "ok",
          result: "PIN_SETUP_ALREADY_REQUIRED",
          value: { pin: statusOf(row, now), sessionsClosed: 0 }
        };
      }
      await client.query(
        `update edge_identity.terminal_pin
            set state = 'reset_required', verifier = null, set_at = null,
                failed_attempts = 0, first_failed_at = null, locked_until = null,
                updated_at = now()
          where terminal_device_id = $1::uuid`,
        [terminal.id]
      );
      const closed = await client.query(
        `update edge_identity.terminal_session set closed_at = now(), status = 'reset'
          where terminal_device_id = $1::uuid and credential_kind = 'terminal_pin'
            and closed_at is null`,
        [terminal.id]
      );
      await audit(client, terminal, {
        eventCode: "terminal_pin.reset",
        actorType: "operator",
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        details: { previousPinVersion: row.pin_version, operatorReference: input.actorRef }
      });
      const after = await readPinRow(client, terminal.id);
      return {
        outcome: "ok",
        result: "PIN_RESET",
        value: { pin: statusOf(after, now), sessionsClosed: closed.rowCount ?? 0 }
      };
    },
    HUB_RUNTIME_ROLE
  );
}
var import_hash_wasm, TERMINAL_PIN_PATTERN, TERMINAL_PIN_FAILURE_LIMIT, TERMINAL_PIN_FAILURE_WINDOW_MINUTES, TERMINAL_PIN_LOCK_MINUTES, TERMINAL_PIN_SESSION_HOURS, TERMINAL_PIN_ARGON2, VERIFIER_PATTERN, WINDOW_MS;
var init_terminal_pin = __esm({
  "src/hub/edge/terminal-pin.ts"() {
    "use strict";
    import_hash_wasm = __toESM(require_index_umd(), 1);
    init_db();
    init_audit();
    init_sync();
    init_runtime_bootstrap();
    TERMINAL_PIN_PATTERN = /^[0-9]{4}$/u;
    TERMINAL_PIN_FAILURE_LIMIT = 5;
    TERMINAL_PIN_FAILURE_WINDOW_MINUTES = 15;
    TERMINAL_PIN_LOCK_MINUTES = 15;
    TERMINAL_PIN_SESSION_HOURS = 8;
    TERMINAL_PIN_ARGON2 = {
      memorySize: 19456,
      iterations: 2,
      parallelism: 1,
      hashLength: 32,
      saltLength: 16
    };
    VERIFIER_PATTERN = /^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u;
    WINDOW_MS = TERMINAL_PIN_FAILURE_WINDOW_MINUTES * 6e4;
  }
});

// src/hub/sync/errors.ts
var SYNC_TRANSIENT_ERROR_CODES, SYNC_DURABLE_REJECTION_CODES, TRANSIENT, DURABLE, SyncDeliveryError;
var init_errors3 = __esm({
  "src/hub/sync/errors.ts"() {
    "use strict";
    SYNC_TRANSIENT_ERROR_CODES = [
      "EDGE_TRANSPORT_UNREACHABLE",
      "EDGE_TRANSPORT_TIMEOUT",
      "EDGE_TRANSPORT_INTERRUPTED",
      "EDGE_CLOUD_UNAVAILABLE",
      "EDGE_CLOUD_RATE_LIMITED",
      "EDGE_LEASE_EXPIRED",
      "EDGE_WORKER_SHUTDOWN",
      "EDGE_OPERATOR_PAUSED"
    ];
    SYNC_DURABLE_REJECTION_CODES = [
      "EDGE_CLOUD_REJECTED_SCHEMA",
      "EDGE_CLOUD_REJECTED_SCOPE",
      "EDGE_CLOUD_REJECTED_SIGNATURE",
      "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
      "EDGE_CLOUD_REJECTED_UNKNOWN_AGGREGATE",
      "EDGE_CLOUD_REJECTED_PERMANENT"
    ];
    TRANSIENT = new Set(SYNC_TRANSIENT_ERROR_CODES);
    DURABLE = new Set(SYNC_DURABLE_REJECTION_CODES);
    SyncDeliveryError = class extends Error {
      constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "SyncDeliveryError";
      }
    };
  }
});

// src/hub/sync/configuration.ts
import { createHash as createHash10 } from "node:crypto";
function snapshotManifest(snapshot) {
  return canonicalJson({
    snapshot_id: snapshot.snapshotId,
    tenant_id: snapshot.tenantId,
    digital_store_id: snapshot.digitalStoreId,
    location_id: snapshot.locationId,
    snapshot_version: snapshot.snapshotVersion.toString(),
    schema_version: snapshot.schemaVersion,
    not_before: snapshot.notBefore.toISOString(),
    expires_at: snapshot.expiresAt?.toISOString() ?? null,
    minimum_hub_version: snapshot.minimumHubVersion,
    maximum_hub_version: snapshot.maximumHubVersion,
    sections: [...snapshot.sections].map((s3) => ({
      section_code: s3.sectionCode,
      section_version: s3.sectionVersion.toString(),
      required: s3.required,
      content_sha256: sectionDigest(s3)
    })).sort((a, b) => a.section_code < b.section_code ? -1 : 1)
  });
}
function sectionDigest(section) {
  return createHash10("sha256").update(canonicalJson(section.content), "utf8").digest("hex");
}
function snapshotManifestSha256(snapshot) {
  return createHash10("sha256").update(snapshotManifest(snapshot), "utf8").digest("hex");
}
async function recordDownloadedSnapshot(client, snapshot) {
  await client.query(
    `insert into edge_config.configuration_snapshot
       (id, tenant_id, digital_store_id, location_id, snapshot_version, schema_version,
        created_at, not_before, expires_at, minimum_hub_version, maximum_hub_version,
        manifest_sha256, signature_algorithm, signature, signing_key_id, state, downloaded_at)
     values ($1, $2, $3, $4, $5::bigint, $6, now(), $7, $8, $9, $10, $11, $12, $13, $14,
             'downloaded', now())`,
    [
      snapshot.snapshotId,
      snapshot.tenantId,
      snapshot.digitalStoreId,
      snapshot.locationId,
      snapshot.snapshotVersion.toString(),
      snapshot.schemaVersion,
      snapshot.notBefore,
      snapshot.expiresAt,
      snapshot.minimumHubVersion,
      snapshot.maximumHubVersion,
      snapshotManifestSha256(snapshot),
      snapshot.signatureAlgorithm,
      snapshot.signature,
      snapshot.signingKeyId
    ]
  );
  for (const section of snapshot.sections) {
    await client.query(
      `insert into edge_config.configuration_section
         (id, snapshot_id, section_code, section_version, content_sha256, content_json,
          required, validation_state)
       values (gen_random_uuid(), $1, $2, $3::bigint, $4, $5::jsonb, $6, 'pending')`,
      [
        snapshot.snapshotId,
        section.sectionCode,
        section.sectionVersion.toString(),
        sectionDigest(section),
        JSON.stringify(section.content),
        section.required
      ]
    );
  }
}
async function verifySnapshot(client, snapshot, verifier) {
  const manifest = snapshotManifest(snapshot);
  const signatureValid = verifier.verify(manifest, {
    algorithm: snapshot.signatureAlgorithm,
    keyId: snapshot.signingKeyId,
    signature: snapshot.signature.toString("base64")
  });
  if (!signatureValid) {
    await client.query(
      `update edge_config.configuration_snapshot set state = 'rejected' where id = $1`,
      [snapshot.snapshotId]
    );
    return {
      verified: false,
      reason: `Snapshot ${snapshot.snapshotId} did not verify against signing key ${snapshot.signingKeyId}.`
    };
  }
  try {
    await client.query(`select edge_config.mark_snapshot_verified($1::uuid, $2::char(64))`, [
      snapshot.snapshotId,
      snapshotManifestSha256(snapshot)
    ]);
  } catch (error) {
    throw new SyncDeliveryError("EDGE_SNAPSHOT_MANIFEST_MISMATCH", error.message, {
      snapshotId: snapshot.snapshotId
    });
  }
  return { verified: true };
}
async function activateSnapshot(client, input) {
  const result = await client.query(
    `select edge_config.activate_snapshot($1::uuid, $2::uuid, $3::text, $4::uuid, $5::jsonb)`,
    [
      input.activationId,
      input.snapshotId,
      input.actorType,
      input.actorId ?? null,
      JSON.stringify(input.healthCheck ?? {})
    ]
  );
  return {
    activationId: input.activationId,
    snapshotId: input.snapshotId,
    previousSnapshotId: result.rows[0]?.activate_snapshot ?? null
  };
}
var init_configuration = __esm({
  "src/hub/sync/configuration.ts"() {
    "use strict";
    init_hub_database();
    init_errors3();
  }
});

// src/hub/sync/signing.ts
import { createHmac, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var DEV_MIN_SIGNING_KEY_BYTES, DevelopmentHmacBatchSigner;
var init_signing = __esm({
  "src/hub/sync/signing.ts"() {
    "use strict";
    init_errors3();
    DEV_MIN_SIGNING_KEY_BYTES = 32;
    DevelopmentHmacBatchSigner = class {
      constructor(keyId, secret) {
        this.keyId = keyId;
        this.secret = secret;
        if (secret.length < DEV_MIN_SIGNING_KEY_BYTES) {
          throw new SyncDeliveryError(
            "EDGE_BATCH_SIGNATURE_MISSING",
            `The development batch signing key must be at least ${DEV_MIN_SIGNING_KEY_BYTES} bytes.`
          );
        }
      }
      algorithm = "hmac-sha256-development";
      sign(manifest) {
        return {
          algorithm: this.algorithm,
          keyId: this.keyId,
          signature: createHmac("sha256", this.secret).update(manifest, "utf8").digest("base64")
        };
      }
      verify(manifest, signature) {
        if (signature.algorithm !== this.algorithm || signature.keyId !== this.keyId) return false;
        const expected = Buffer.from(this.sign(manifest).signature, "base64");
        let presented;
        try {
          presented = Buffer.from(signature.signature, "base64");
        } catch {
          return false;
        }
        if (expected.length !== presented.length) return false;
        return timingSafeEqual2(expected, presented);
      }
    };
  }
});

// src/hub/dev-configuration.ts
var dev_configuration_exports = {};
__export(dev_configuration_exports, {
  DEV_CONFIGURATION_KEY_ID: () => DEV_CONFIGURATION_KEY_ID,
  DEV_CONFIGURATION_KEY_PATH: () => DEV_CONFIGURATION_KEY_PATH,
  DevelopmentConfigurationRefused: () => DevelopmentConfigurationRefused,
  TERMINAL_PROFILES_SECTION: () => TERMINAL_PROFILES_SECTION,
  loadOrCreateDevelopmentSigner: () => loadOrCreateDevelopmentSigner,
  publishDevelopmentConfiguration: () => publishDevelopmentConfiguration
});
import { randomBytes as randomBytes4, randomUUID as randomUUID9 } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function loadOrCreateDevelopmentSigner(path = DEV_CONFIGURATION_KEY_PATH) {
  let secret;
  try {
    secret = Buffer.from(readFileSync3(path, "utf8").trim(), "base64");
  } catch {
    secret = randomBytes4(32);
    mkdirSync(dirname(path), { recursive: true, mode: 448 });
    writeFileSync(path, `${secret.toString("base64")}
`, { mode: 384 });
    chmodSync(path, 384);
  }
  return new DevelopmentHmacBatchSigner(DEV_CONFIGURATION_KEY_ID, secret);
}
async function publishDevelopmentConfiguration(pool, input) {
  if (input.environment !== "development") {
    throw new DevelopmentConfigurationRefused(
      "KLUY-HUB-DEV-CONFIG-ENVIRONMENT",
      `this Hub declares environment '${input.environment}'; a development-signed configuration is permitted in development only (owner decision 2026-09-10)`
    );
  }
  if (input.grants.length === 0) {
    throw new DevelopmentConfigurationRefused(
      "KLUY-HUB-DEV-CONFIG-EMPTY",
      "no profile grants were given; an empty configuration would activate and grant nothing"
    );
  }
  const signer = input.signer ?? loadOrCreateDevelopmentSigner();
  const now = input.now ?? /* @__PURE__ */ new Date();
  return withHubTransaction(
    pool,
    async (client) => {
      const versions = await client.query(
        `select coalesce(max(snapshot_version), 0) + 1 as next
           from edge_config.configuration_snapshot where location_id = $1::uuid`,
        [input.locationId]
      );
      const snapshotVersion = BigInt(versions.rows[0]?.next ?? "1");
      const section = {
        sectionCode: TERMINAL_PROFILES_SECTION,
        sectionVersion: snapshotVersion,
        required: true,
        content: {
          grants: input.grants.map((grant) => ({
            terminal_device_id: grant.terminalDeviceId,
            profile_codes: [...grant.profileCodes].sort()
          }))
        }
      };
      const extra = (input.extraSections ?? []).filter((x) => x.sectionCode !== TERMINAL_PROFILES_SECTION).map((x) => ({
        sectionCode: x.sectionCode,
        sectionVersion: snapshotVersion,
        required: x.required ?? false,
        content: x.content
      }));
      const unsigned = {
        snapshotId: randomUUID9(),
        tenantId: input.tenantId,
        digitalStoreId: input.digitalStoreId,
        locationId: input.locationId,
        snapshotVersion,
        schemaVersion: 1,
        notBefore: now,
        expiresAt: null,
        minimumHubVersion: "0.1.0",
        maximumHubVersion: null,
        sections: [section, ...extra]
      };
      const signature = signer.sign(
        snapshotManifest({
          ...unsigned,
          signatureAlgorithm: signer.algorithm,
          signature: Buffer.alloc(0),
          signingKeyId: signer.keyId
        })
      );
      const snapshot = {
        ...unsigned,
        signatureAlgorithm: signature.algorithm,
        signature: Buffer.from(signature.signature, "base64"),
        signingKeyId: signature.keyId
      };
      await recordDownloadedSnapshot(client, snapshot);
      const verdict = await verifySnapshot(client, snapshot, signer);
      if (!verdict.verified) {
        throw new DevelopmentConfigurationRefused(
          "KLUY-HUB-DEV-CONFIG-SIGNATURE",
          verdict.reason ?? "the snapshot did not verify against its own signer"
        );
      }
      const activation = await activateSnapshot(client, {
        activationId: randomUUID9(),
        snapshotId: snapshot.snapshotId,
        actorType: "service",
        healthCheck: { source: "development-configuration-publisher" }
      });
      if (input.supersedeOpenGrants === true) {
        await client.query(
          `update edge_config.terminal_profile_assignment
              set effective_until = $2::timestamptz
            where location_id = $1::uuid and enabled and effective_until is null
              and effective_from < $2::timestamptz`,
          [input.locationId, now.toISOString()]
        );
      }
      let grantsWritten = 0;
      for (const grant of input.grants) {
        for (const profileCode of grant.profileCodes) {
          await client.query(
            `insert into edge_config.terminal_profile_assignment
               (id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
                assignment_version, enabled, effective_from, effective_until, source_snapshot_id)
             values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
                     $6::bigint, true, $7, null, $8::uuid)`,
            [
              input.tenantId,
              input.digitalStoreId,
              input.locationId,
              grant.terminalDeviceId,
              profileCode,
              snapshotVersion.toString(),
              now,
              snapshot.snapshotId
            ]
          );
          grantsWritten += 1;
        }
      }
      return {
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshotVersion.toString(),
        previousSnapshotId: activation.previousSnapshotId,
        grantsWritten
      };
    },
    HUB_RUNTIME_ROLE
  );
}
var DEV_CONFIGURATION_KEY_PATH, DEV_CONFIGURATION_KEY_ID, TERMINAL_PROFILES_SECTION, DevelopmentConfigurationRefused;
var init_dev_configuration = __esm({
  "src/hub/dev-configuration.ts"() {
    "use strict";
    init_db();
    init_configuration();
    init_signing();
    DEV_CONFIGURATION_KEY_PATH = "/var/lib/kitluy/operational/development-configuration-signing.key";
    DEV_CONFIGURATION_KEY_ID = "kitluy.development-configuration-signer.v1";
    TERMINAL_PROFILES_SECTION = "terminal_profiles";
    DevelopmentConfigurationRefused = class extends Error {
      constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.code = code;
        this.name = "DevelopmentConfigurationRefused";
      }
    };
  }
});

// ../../packages/observability/dist/index.js
var SECRET_FIELD_PATTERN = /(password|secret|token|api[_-]?key|service[_-]?role|credential)/i;
function redactFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_FIELD_PATTERN.test(k) ? "[REDACTED]" : v;
  }
  return out;
}
function createLogger(service, bound = {}, sink = (line) => {
  process.stdout.write(line + "\n");
}) {
  const emit = (level, message, fields) => {
    sink(JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      service,
      message,
      ...redactFields({ ...bound, ...fields })
    }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger(service, { ...bound, ...extra }, sink)
  };
}

// ../../verticals/phase1-laundry/dist/terminal-profiles.js
var LAUNDRY_TERMINAL_PROFILES = [
  "laundry.t1.intake_cashier",
  "laundry.t2.customer_display",
  "laundry.t3.ready_scan_in",
  "laundry.t4.pickup_scan_out"
];
var RETIRED_TERMINAL_IDENTIFIERS = ["t2_scan_in", "t3_scan_out"];
var PRE_RENAME_TERMINAL_IDENTIFIERS = [
  "t1_intake_cashier",
  "t2_customer_display",
  "t3_ready_scan_in",
  "t4_pickup_scan_out"
];
var REJECTED_TERMINAL_IDENTIFIERS = [
  ...RETIRED_TERMINAL_IDENTIFIERS,
  ...PRE_RENAME_TERMINAL_IDENTIFIERS
];
function isLaundryTerminalProfile(value) {
  return LAUNDRY_TERMINAL_PROFILES.includes(value);
}

// ../../packages/money/dist/index.js
var CURRENCIES = {
  /** Cambodian riel — zero minor-unit digits (whole riel). */
  KHR: { code: "KHR", minorUnitDigits: 0 },
  /** United States dollar — two minor-unit digits (cents). */
  USD: { code: "USD", minorUnitDigits: 2 }
};
var MoneyError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "MoneyError";
  }
};
function money(currency, minorUnits) {
  if (!(currency in CURRENCIES)) {
    throw new MoneyError("UNKNOWN_CURRENCY", `Unknown currency: ${String(currency)}`);
  }
  if (typeof minorUnits === "number") {
    if (!Number.isSafeInteger(minorUnits)) {
      throw new MoneyError("NON_INTEGER_AMOUNT", `Money requires integer minor units, got ${minorUnits}. Floating-point money is prohibited (RB v4 \xA79.4).`);
    }
    minorUnits = BigInt(minorUnits);
  }
  return { currency, minorUnits };
}
function multiplyByQuantity(a, quantity) {
  if (typeof quantity === "number" && !Number.isSafeInteger(quantity)) {
    throw new MoneyError("NON_INTEGER_AMOUNT", "multiplyByQuantity takes integer quantities; fractional quantities (e.g. weight) must go through an approved pricing calculation with an explicit rounding rule.");
  }
  return { currency: a.currency, minorUnits: a.minorUnits * BigInt(quantity) };
}
var isNegative = (a) => a.minorUnits < 0n;

// ../../verticals/phase1-laundry/dist/pricing.js
function pricePerPieceLine(line) {
  if (!Number.isSafeInteger(line.pieceCount) || line.pieceCount <= 0) {
    throw new Error("pieceCount must be a positive integer.");
  }
  if (isNegative(line.unitPriceSnapshot))
    throw new Error("Unit price cannot be negative.");
  return multiplyByQuantity(line.unitPriceSnapshot, line.pieceCount);
}
function pricePerWeightLine(line, rule) {
  if (!Number.isSafeInteger(line.weightGrams) || line.weightGrams <= 0) {
    throw new Error("weightGrams must be a positive integer (scale capture).");
  }
  if (isNegative(line.pricePerKgSnapshot))
    throw new Error("Price cannot be negative.");
  const numerator = line.pricePerKgSnapshot.minorUnits * BigInt(line.weightGrams);
  const denominator = 1000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  let minorUnits = quotient;
  if (remainder > 0n) {
    if (rule === "round_up_minor_unit")
      minorUnits += 1n;
    else if (remainder * 2n >= denominator)
      minorUnits += 1n;
  }
  return { currency: line.pricePerKgSnapshot.currency, minorUnits };
}

// ../../verticals/phase1-laundry/dist/booking-lifecycle.js
var BOOKING_LIFECYCLE_TRANSITIONS = {
  DRAFT: ["CONFIRMED/FINALIZED", "EXPIRED"],
  "CONFIRMED/FINALIZED": ["IN_PROGRESS", "CANCELLED", "VOIDED"],
  IN_PROGRESS: ["PARTIALLY_FULFILLED", "ISSUE_HOLD", "RETURN/REFUND"],
  PARTIALLY_FULFILLED: ["FULFILLED/COMPLETED"],
  "FULFILLED/COMPLETED": [],
  EXPIRED: [],
  CANCELLED: [],
  VOIDED: [],
  ISSUE_HOLD: [],
  "RETURN/REFUND": []
};
var BookingLifecycleTransitionError = class extends Error {
  constructor(from, to) {
    super(`Illegal Booking lifecycle transition ${from} \u2192 ${to} (kitluy-transaction-and-booking-lifecycle-v1.0.0.md \xA74).`);
    this.name = "BookingLifecycleTransitionError";
  }
};
function canBookingTransition(from, to) {
  return BOOKING_LIFECYCLE_TRANSITIONS[from].includes(to);
}
function transitionBooking(from, to) {
  if (!canBookingTransition(from, to))
    throw new BookingLifecycleTransitionError(from, to);
  return to;
}

// ../../verticals/phase1-laundry/dist/production-state-machine.js
var PRODUCTION_STATES = [
  "RECEIVED",
  "WASHING",
  "DRYING",
  "PRESSING",
  "QA_PACKAGING",
  "READY",
  "PICKED_UP"
];

// ../../verticals/phase1-laundry/dist/catalog-section.js
var LAUNDRY_CATALOG_SCHEMA = "kitluy.config.catalog.v1";
var LAUNDRY_MONEY_SCHEMA = "kitluy.config.money.v1";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
var HEX64 = /^[0-9a-f]{64}$/u;
var CODE = /^[A-Z][A-Z0-9_-]{1,39}$/u;
function rec(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function str(r, key) {
  const v = r[key];
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
}
function int(r, key) {
  const v = r[key];
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}
function codes(r, key) {
  const v = r[key];
  if (v === void 0 || v === null)
    return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !CODE.test(x)))
    return null;
  return v;
}
function parseLaundryCatalogSection(value) {
  const r = rec(value);
  if (r === null || r["schema"] !== LAUNDRY_CATALOG_SCHEMA)
    return null;
  const currencyCode = str(r, "currency_code");
  const contentHash = str(r, "content_hash");
  if (currencyCode === null || !/^[A-Z]{3}$/u.test(currencyCode))
    return null;
  if (contentHash === null || !HEX64.test(contentHash))
    return null;
  const families = [];
  for (const raw of Array.isArray(r["families"]) ? r["families"] : []) {
    const f = rec(raw);
    const code = f === null ? null : str(f, "code");
    const name = f === null ? null : str(f, "name");
    const lane = f?.["lane"];
    if (f === null || code === null || !CODE.test(code) || name === null)
      return null;
    if (lane !== "per_weight" && lane !== "per_piece")
      return null;
    families.push({
      code,
      lane,
      name,
      nameKm: str(f, "name_km"),
      sortOrder: int(f, "sort_order") ?? 0
    });
  }
  const categories = [];
  for (const raw of Array.isArray(r["categories"]) ? r["categories"] : []) {
    const c = rec(raw);
    const code = c === null ? null : str(c, "code");
    const name = c === null ? null : str(c, "name");
    const familyCodes = c === null ? null : codes(c, "family_codes");
    if (c === null || code === null || !CODE.test(code) || name === null || familyCodes === null)
      return null;
    categories.push({
      code,
      name,
      nameKm: str(c, "name_km"),
      sortOrder: int(c, "sort_order") ?? 0,
      familyCodes
    });
  }
  const services = [];
  for (const raw of Array.isArray(r["services"]) ? r["services"] : []) {
    const s3 = rec(raw);
    if (s3 === null)
      return null;
    const serviceId = str(s3, "service_id");
    const serviceCode = str(s3, "service_code");
    const name = str(s3, "name");
    const pricingMode = s3["pricing_mode"];
    const unitPriceMinor = int(s3, "unit_price_minor");
    const currency = str(s3, "currency_code");
    if (serviceId === null || !UUID.test(serviceId) || serviceCode === null || !CODE.test(serviceCode))
      return null;
    if (name === null || pricingMode !== "PER_PIECE" && pricingMode !== "PER_WEIGHT")
      return null;
    if (unitPriceMinor === null || unitPriceMinor < 0 || currency === null)
      return null;
    const familyCode = str(s3, "family_code");
    if (familyCode !== null && !CODE.test(familyCode))
      return null;
    services.push({
      serviceId: serviceId.toLowerCase(),
      serviceCode,
      familyCode,
      name,
      displayName: str(s3, "display_name") ?? name,
      nameKm: str(s3, "name_km"),
      garmentCode: str(s3, "garment_code"),
      categoryCode: str(s3, "category_code"),
      iconKey: str(s3, "icon_key"),
      sortOrder: int(s3, "sort_order") ?? 0,
      pricingMode,
      currencyCode: currency,
      unitPriceMinor,
      minChargeMinor: int(s3, "min_charge_minor"),
      locationPrice: s3["location_price"] === true,
      serviceVersion: Math.max(1, int(s3, "service_version") ?? 1)
    });
  }
  const garmentTypes = [];
  for (const raw of Array.isArray(r["garment_types"]) ? r["garment_types"] : []) {
    const g = rec(raw);
    const code = g === null ? null : str(g, "code");
    const name = g === null ? null : str(g, "name");
    const familyCodes = g === null ? null : codes(g, "family_codes");
    if (g === null || code === null || !CODE.test(code) || name === null || familyCodes === null)
      return null;
    garmentTypes.push({
      code,
      name,
      nameKm: str(g, "name_km"),
      categoryCode: str(g, "category_code"),
      sortOrder: int(g, "sort_order") ?? 0,
      familyCodes
    });
  }
  return {
    schema: LAUNDRY_CATALOG_SCHEMA,
    currencyCode,
    contentHash,
    families,
    categories,
    services,
    garmentTypes
  };
}
function parseLaundryMoneySection(value) {
  const r = rec(value);
  if (r === null || r["schema"] !== LAUNDRY_MONEY_SCHEMA)
    return null;
  const currencyCode = str(r, "currency_code");
  const currencyExponent = int(r, "currency_exponent");
  if (currencyCode === null || !/^[A-Z]{3}$/u.test(currencyCode))
    return null;
  if (currencyExponent === null || currencyExponent < 0 || currencyExponent > 4)
    return null;
  let weightRule = null;
  const w = rec(r["weight_rule"]);
  if (w !== null) {
    const increment = w["increment"];
    const minimum = w["minimum"];
    const rounding = w["rounding"];
    if (w["unit"] !== "kg" || typeof increment !== "number" || !(increment > 0) || typeof minimum !== "number" || !(minimum >= 0) || rounding !== "up" && rounding !== "nearest") {
      return null;
    }
    weightRule = { unit: "kg", increment, rounding, minimum };
  }
  let khrPerUsd = null;
  const usd = rec(rec(r["fx"])?.["USD"]);
  if (usd !== null) {
    const rate = int(usd, "khr_per_usd");
    if (rate === null || rate < 1)
      return null;
    khrPerUsd = rate;
  }
  const express = r["express_surcharge_bps"];
  const expressSurchargeBps = express === void 0 || express === null ? null : typeof express === "number" && Number.isInteger(express) && express >= 0 ? express : NaN;
  if (Number.isNaN(expressSurchargeBps))
    return null;
  return {
    schema: LAUNDRY_MONEY_SCHEMA,
    currencyCode,
    currencyExponent,
    moneyRounding: str(r, "money_rounding") ?? "round_half_up_minor_unit",
    weightRule,
    locationCode: str(r, "location_code"),
    khrPerUsd,
    expressSurchargeBps
  };
}
function billableKilograms(weighedKg, rule) {
  if (!(weighedKg > 0))
    return 0;
  const steps = weighedKg / rule.increment;
  const rounded = rule.rounding === "up" ? Math.ceil(steps - 1e-9) : Math.round(steps);
  return Math.max(rule.minimum, rounded * rule.increment);
}

// ../../verticals/phase1-laundry/dist/intake-quote.js
function weightRoundingRuleOf(moneyRounding) {
  if (moneyRounding === "round_half_up_minor_unit")
    return "round_half_up_minor_unit";
  if (moneyRounding === "round_up_minor_unit")
    return "round_up_minor_unit";
  return null;
}
function basisPoints(value, bps) {
  if (!Number.isInteger(bps) || bps < 0)
    throw new Error("bps must be a non-negative integer.");
  const numerator = value * BigInt(bps);
  const quotient = numerator / 10000n;
  const remainder = numerator % 10000n;
  return remainder * 2n >= 10000n ? quotient + 1n : quotient;
}
function fourDecimals(value) {
  return value.toFixed(4);
}
function quoteIntakeLines(catalog, moneyContract, lines, options = {}) {
  if (lines.length === 0)
    return { ok: false, refusal: { code: "NO_LINES" } };
  const currency = moneyContract.currencyCode;
  const rounding = weightRoundingRuleOf(moneyContract.moneyRounding);
  if (rounding === null) {
    return {
      ok: false,
      refusal: { code: "MONEY_ROUNDING_UNKNOWN", moneyRounding: moneyContract.moneyRounding }
    };
  }
  const byId = new Map(catalog.services.map((service) => [service.serviceId.toLowerCase(), service]));
  const quoted = [];
  let subtotal = 0n;
  for (const line of lines) {
    const service = byId.get(line.serviceId.toLowerCase());
    if (service === void 0) {
      return { ok: false, refusal: { code: "SERVICE_UNKNOWN", serviceId: line.serviceId } };
    }
    if (service.currencyCode !== currency) {
      return { ok: false, refusal: { code: "CURRENCY_MISMATCH", serviceId: line.serviceId } };
    }
    const hasPieces = line.pieceCount !== void 0;
    const hasWeight = line.weighedGrams !== void 0;
    if (hasPieces === hasWeight) {
      return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
    }
    const unitPrice = money(currency, BigInt(service.unitPriceMinor));
    if (service.pricingMode === "PER_PIECE") {
      if (!hasPieces) {
        return { ok: false, refusal: { code: "PRICING_MODE_MISMATCH", serviceId: line.serviceId } };
      }
      const pieceCount = line.pieceCount ?? 0;
      if (!Number.isSafeInteger(pieceCount) || pieceCount <= 0 || pieceCount > 9999) {
        return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
      }
      const priced2 = pricePerPieceLine({
        kind: "per_piece",
        serviceCode: service.serviceCode,
        unitPriceSnapshot: unitPrice,
        pieceCount
      });
      quoted.push({
        serviceId: service.serviceId,
        serviceCode: service.serviceCode,
        serviceVersion: service.serviceVersion,
        displayName: service.displayName,
        familyCode: service.familyCode,
        pricingMethod: "per_piece",
        unitCode: "piece",
        unitPriceMinor: unitPrice.minorUnits,
        quantity: fourDecimals(pieceCount),
        pieceCount,
        weighedGrams: null,
        billableGrams: null,
        lineSubtotalMinor: priced2.minorUnits
      });
      subtotal += priced2.minorUnits;
      continue;
    }
    if (!hasWeight) {
      return { ok: false, refusal: { code: "PRICING_MODE_MISMATCH", serviceId: line.serviceId } };
    }
    const weighedGrams = line.weighedGrams ?? 0;
    if (!Number.isSafeInteger(weighedGrams) || weighedGrams <= 0 || weighedGrams > 9999e3) {
      return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
    }
    if (moneyContract.weightRule === null) {
      return { ok: false, refusal: { code: "WEIGHT_RULE_MISSING" } };
    }
    const billableKg = billableKilograms(weighedGrams / 1e3, moneyContract.weightRule);
    const billableGrams = Math.round(billableKg * 1e3);
    if (billableGrams <= 0) {
      return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
    }
    const priced = pricePerWeightLine({
      kind: "per_weight",
      serviceCode: service.serviceCode,
      pricePerKgSnapshot: unitPrice,
      weightGrams: billableGrams
    }, rounding);
    quoted.push({
      serviceId: service.serviceId,
      serviceCode: service.serviceCode,
      serviceVersion: service.serviceVersion,
      displayName: service.displayName,
      familyCode: service.familyCode,
      pricingMethod: "per_weight",
      unitCode: "kg",
      unitPriceMinor: unitPrice.minorUnits,
      quantity: fourDecimals(billableGrams / 1e3),
      pieceCount: null,
      weighedGrams,
      billableGrams,
      lineSubtotalMinor: priced.minorUnits
    });
    subtotal += priced.minorUnits;
  }
  const express = options.express === true;
  let expressSurcharge = 0n;
  if (express) {
    if (moneyContract.expressSurchargeBps === null) {
      return { ok: false, refusal: { code: "EXPRESS_NOT_CONFIGURED" } };
    }
    expressSurcharge = basisPoints(subtotal, moneyContract.expressSurchargeBps);
  }
  return {
    ok: true,
    quote: {
      currencyCode: currency,
      currencyExponent: moneyContract.currencyExponent,
      lines: quoted,
      subtotalMinor: subtotal,
      express,
      expressSurchargeBps: moneyContract.expressSurchargeBps,
      expressSurchargeMinor: expressSurcharge,
      totalMinor: subtotal + expressSurcharge
    }
  };
}
function usdCentsToKhr(usdCents, khrPerUsd) {
  if (!Number.isInteger(khrPerUsd) || khrPerUsd < 1)
    throw new Error("khrPerUsd must be >= 1.");
  const numerator = usdCents * BigInt(khrPerUsd);
  const quotient = numerator / 100n;
  const remainder = numerator % 100n;
  return remainder * 2n >= 100n ? quotient + 1n : quotient;
}
function settleCashTender(totalMinor, moneyContract, tender) {
  const currency = moneyContract.currencyCode;
  if (tender.localMinor < 0n || tender.usdCents < 0n || totalMinor < 0n) {
    return { ok: false, refusal: { code: "TENDER_INVALID" } };
  }
  const legs = [];
  let tendered = 0n;
  if (tender.localMinor > 0n) {
    legs.push({
      tenderType: "cash",
      currencyCode: currency,
      currencyExponent: moneyContract.currencyExponent,
      amountMinor: tender.localMinor,
      localEquivalentMinor: tender.localMinor,
      khrPerUsd: null
    });
    tendered += tender.localMinor;
  }
  if (tender.usdCents > 0n) {
    if (currency !== "KHR" || moneyContract.khrPerUsd === null) {
      return { ok: false, refusal: { code: "FX_RATE_UNAVAILABLE" } };
    }
    const equivalent = usdCentsToKhr(tender.usdCents, moneyContract.khrPerUsd);
    legs.push({
      tenderType: "cash",
      currencyCode: "USD",
      currencyExponent: 2,
      amountMinor: tender.usdCents,
      localEquivalentMinor: equivalent,
      khrPerUsd: moneyContract.khrPerUsd
    });
    tendered += equivalent;
  }
  if (tendered < totalMinor) {
    return {
      ok: false,
      refusal: { code: "TENDER_INSUFFICIENT", shortMinor: totalMinor - tendered }
    };
  }
  return {
    ok: true,
    settlement: {
      currencyCode: currency,
      currencyExponent: moneyContract.currencyExponent,
      tenderedMinor: tendered,
      appliedMinor: totalMinor,
      changeDueMinor: tendered - totalMinor,
      legs
    }
  };
}

// src/index.ts
var SERVICE_NAME = "kitluy-hub-agent";
var SERVICE_VERSION = "0.1.0";

// src/bin/hub-agent.ts
init_db();

// ../../packages/api-errors/dist/index.js
var ERROR_CODES = {
  // Shared foundation — API Error Code Registry v1.0.0 §4 (surface: ALL).
  AUTHENTICATION_REQUIRED: {
    httpStatus: 401,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  /** Registry §4: absent scope OR permission — one code, no policy internals leaked. */
  SCOPE_PERMISSION_DENIED: {
    httpStatus: 403,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  RESOURCE_NOT_FOUND: { httpStatus: 404, retryable: false, terminal: true, retryGuidance: "none" },
  VALIDATION_FAILED: { httpStatus: 422, retryable: false, terminal: true, retryGuidance: "none" },
  /** Registry §4: expected version/ETag mismatch — refresh and reconcile, never blind-retry. */
  RESOURCE_VERSION_CONFLICT: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  /** Registry §4: key reused with a different semantic payload. */
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  RATE_LIMITED: { httpStatus: 429, retryable: true, terminal: true, retryGuidance: "backoff" },
  /**
   * KLD-2026-07-26-002 Group 5 (additive; renamed from the scaffold `INTERNAL`):
   * HTTP 500, retryable with the SAME idempotency key. The server must never
   * claim success when the authoritative outcome is unknown.
   */
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: true,
    terminal: true,
    retryGuidance: "same-idempotency-key"
  },
  /** Registry §4: a required internal dependency is unavailable — retry with backoff or queue. */
  DEPENDENCY_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    terminal: true,
    retryGuidance: "backoff"
  },
  /**
   * Registry §4: required Store-operational truth is too stale. `retryable` is
   * FALSE — the caller must wait for sync or use the authorized Edge workflow
   * instead of replaying the same request.
   */
  STALE_OPERATIONAL_DATA: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  // Edge codes (POS Desktop spec v4.0.0 §14.3; statuses per registry §4 where listed)
  DEVICE_NOT_ASSIGNED: { httpStatus: 403, retryable: false, terminal: true, retryGuidance: "none" },
  PROFILE_NOT_ALLOWED: { httpStatus: 403, retryable: false, terminal: true, retryGuidance: "none" },
  HUB_UNREACHABLE: { httpStatus: 503, retryable: true, terminal: true, retryGuidance: "backoff" },
  /**
   * KLD-2026-07-26-002 Group 5 (additive): HTTP 503, mutations stay BLOCKED
   * while the Store Hub is in read-only safety mode. The same idempotency key
   * may be retried only after Hub health and write authority recover.
   */
  HUB_READ_ONLY: {
    httpStatus: 503,
    retryable: true,
    terminal: true,
    retryGuidance: "after-hub-write-health-recovers"
  },
  CONFIG_VERSION_INCOMPATIBLE: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  /**
   * KLD-2026-07-26-002 Group 5 + API Error Code Registry v1.0.0 §4:
   * an ACCEPTED, NON-TERMINAL business outcome returned with HTTP 202. It is
   * neither a terminal error nor authoritative payment success. No client,
   * Store Hub, connector, POS or API may mark a Booking paid until
   * authoritative confirmation is recorded — see `assertNotPaid`.
   */
  PAYMENT_PENDING: {
    httpStatus: 202,
    retryable: true,
    terminal: false,
    retryGuidance: "poll-for-authoritative-outcome"
  },
  /** Registry §4: 503 (not 502) — fix the peripheral and retry the same print job. */
  PRINT_FAILED: { httpStatus: 503, retryable: true, terminal: true, retryGuidance: "backoff" },
  /**
   * KLD-2026-07-26-002 Group 5 (additive; status corrected 409 -> 422):
   * retryable only after a stable reading is available.
   */
  SCALE_UNSTABLE: {
    httpStatus: 422,
    retryable: true,
    terminal: true,
    retryGuidance: "after-stable-reading"
  },
  /**
   * KLD-2026-07-26-002 Group 5 (additive): HTTP 409 and NOT safe for blind
   * automatic replay. The operator must resolve or record the exception before
   * Ready or pickup completion.
   */
  GARMENT_COUNT_MISMATCH: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "operator-resolution-required"
  },
  STORAGE_POSITION_OCCUPIED: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  /** POS Desktop spec v4.0.0 §14.3; no counterpart row in registry v1.0.0 §4 yet. */
  COLLECTOR_VERIFICATION_REQUIRED: {
    httpStatus: 403,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  /** POS Desktop spec v4.0.0 §14.3; no counterpart row in registry v1.0.0 §4 yet. */
  BALANCE_PAYMENT_REQUIRED: {
    httpStatus: 402,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  },
  PICKUP_RELEASE_BLOCKED: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none"
  }
};
function httpStatusFor(code) {
  return ERROR_CODES[code].httpStatus;
}
function isRetryable(code) {
  return ERROR_CODES[code].retryable;
}
function errorEnvelope(code, message, extras) {
  return {
    error: {
      code,
      message,
      ...extras?.correlationId !== void 0 ? { correlationId: extras.correlationId } : {},
      ...extras?.details !== void 0 ? { details: extras.details } : {}
    }
  };
}

// src/hub/repositories/index.ts
init_audit();

// src/hub/repositories/config.ts
var config_exports = {};
__export(config_exports, {
  findActiveConfiguration: () => findActiveConfiguration,
  findActiveProfileAssignment: () => findActiveProfileAssignment,
  findConfigurationSection: () => findConfigurationSection,
  findPeripheralBinding: () => findPeripheralBinding
});
async function findActiveConfiguration(client, locationId) {
  const result = await client.query(
    `select snapshot_id, tenant_id, digital_store_id, location_id, snapshot_version,
            schema_version, manifest_sha256, signing_key_id, not_before, expires_at,
            activated_at
       from edge_config.active_configuration where location_id = $1`,
    [locationId]
  );
  return result.rows[0];
}
async function findConfigurationSection(client, snapshotId, sectionCode) {
  const result = await client.query(
    `select id, snapshot_id, section_code, section_version, content_sha256,
            content_json, required, validation_state
       from edge_config.configuration_section
      where snapshot_id = $1 and section_code = $2`,
    [snapshotId, sectionCode]
  );
  return result.rows[0];
}
async function findActiveProfileAssignment(client, terminalDeviceId, profileCode) {
  const result = await client.query(
    `select id, tenant_id, digital_store_id, location_id, terminal_device_id,
            profile_code, assignment_version, enabled, effective_from,
            effective_until, source_snapshot_id
       from edge_config.terminal_profile_assignment
      where terminal_device_id = $1 and profile_code = $2
        and enabled and effective_until is null`,
    [terminalDeviceId, profileCode]
  );
  return result.rows[0];
}
async function findPeripheralBinding(client, locationId, logicalRole) {
  const result = await client.query(
    `select id, location_id, logical_role, connection_uri, terminal_device_id,
            fallback_priority, enabled
       from edge_config.peripheral_binding
      where location_id = $1 and logical_role = $2 and enabled
      order by fallback_priority asc
      limit 1`,
    [locationId, logicalRole]
  );
  return result.rows[0];
}

// src/hub/repositories/documents.ts
var documents_exports = {};
__export(documents_exports, {
  buildSuppressionKey: () => buildSuppressionKey,
  countQueuedPrintJobs: () => countQueuedPrintJobs,
  enqueuePrintJob: () => enqueuePrintJob,
  findPrintJobBySuppressionKey: () => findPrintJobBySuppressionKey,
  insertReceipt: () => insertReceipt
});
function buildSuppressionKey(documentId, documentVersion, printerBindingId, copyIndex) {
  return `print1.${documentId}.${documentVersion.toString()}.${printerBindingId}.${copyIndex}`;
}
async function insertReceipt(client, input) {
  await client.query(
    `insert into edge_documents.receipt
       (id, tenant_id, digital_store_id, location_id, booking_id, payment_id,
        receipt_number, document_type, template_version, content_sha256, issued_at,
        issued_by, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.paymentId,
      input.receiptNumber,
      input.documentType,
      input.templateVersion.toString(),
      input.contentSha256,
      input.issuedBy,
      input.eventId
    ]
  );
}
async function findPrintJobBySuppressionKey(client, suppressionKey) {
  const result = await client.query(
    `select id, document_type, document_id, printer_binding_id, payload_sha256,
            duplicate_suppression_key, state, attempt_count
       from edge_documents.print_job where duplicate_suppression_key = $1`,
    [suppressionKey]
  );
  return result.rows[0];
}
async function enqueuePrintJob(client, input) {
  const suppressionKey = buildSuppressionKey(
    input.documentId,
    input.templateVersion,
    input.printerBindingId,
    input.copyIndex
  );
  const existing = await findPrintJobBySuppressionKey(client, suppressionKey);
  if (existing) return existing.id;
  await client.query(
    `insert into edge_documents.print_job
       (id, tenant_id, digital_store_id, location_id, document_type, document_id,
        printer_binding_id, template_version, payload_sha256, copies,
        duplicate_suppression_key, state, priority, created_at, next_attempt_at,
        attempt_count, created_by, terminal_device_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             'queued'::edge_documents.print_state, $12, now(), now(), 0, $13, $14)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.documentType,
      input.documentId,
      input.printerBindingId,
      input.templateVersion.toString(),
      input.payloadSha256,
      input.copies,
      suppressionKey,
      input.priority,
      input.createdBy,
      input.terminalDeviceId
    ]
  );
  return input.id;
}
async function countQueuedPrintJobs(client, locationId) {
  const result = await client.query(
    `select count(*)::text as count from edge_documents.print_job
      where location_id = $1 and state = 'queued'`,
    [locationId]
  );
  return Number(result.rows[0]?.count ?? "0");
}

// src/hub/repositories/files.ts
init_errors();

// src/hub/repositories/identity.ts
var identity_exports = {};
__export(identity_exports, {
  findActiveHubAssignment: () => findActiveHubAssignment,
  findDeviceCredentials: () => findDeviceCredentials,
  findStaffCache: () => findStaffCache,
  findTerminalDevice: () => findTerminalDevice,
  findTerminalSession: () => findTerminalSession
});
async function findActiveHubAssignment(client) {
  const result = await client.query(
    `select id, hub_device_id, tenant_id, digital_store_id, location_id,
            assignment_generation, status, ended_at
       from edge_identity.hub_assignment
      where ended_at is null`
  );
  return result.rows[0];
}
async function findTerminalDevice(client, terminalDeviceId) {
  const result = await client.query(
    `select id, tenant_id, digital_store_id, location_id, terminal_name,
            assignment_generation, lifecycle_status, certificate_serial,
            last_client_sequence
       from edge_identity.terminal_device where id = $1`,
    [terminalDeviceId]
  );
  return result.rows[0];
}
async function findDeviceCredentials(client, deviceId) {
  const result = await client.query(
    `select id, device_id, certificate_serial, status, expires_at, revoked_at, revocation_reason
       from edge_identity.device_credential where device_id = $1`,
    [deviceId]
  );
  return result.rows;
}
async function findTerminalSession(client, sessionId) {
  const result = await client.query(
    `select id, tenant_id, digital_store_id, location_id, terminal_device_id,
            actor_id, profile_code, opened_at, expires_at, closed_at,
            session_generation, status, credential_kind
       from edge_identity.terminal_session where id = $1`,
    [sessionId]
  );
  return result.rows[0];
}
async function findStaffCache(client, actorId) {
  const result = await client.query(
    `select actor_id, tenant_id, digital_store_id, location_id, display_name,
            permission_snapshot_version, profile_codes, offline_valid_until,
            disabled
       from edge_identity.staff_cache where actor_id = $1`,
    [actorId]
  );
  return result.rows[0];
}

// src/hub/repositories/laundry.ts
var laundry_exports = {};
__export(laundry_exports, {
  allocateBusinessNumber: () => allocateBusinessNumber,
  appendCustodyEvent: () => appendCustodyEvent,
  appendStatusEvent: () => appendStatusEvent,
  clearStorageAssignments: () => clearStorageAssignments,
  countBlockingExceptions: () => countBlockingExceptions,
  deleteDraftBookingLines: () => deleteDraftBookingLines,
  findBooking: () => findBooking,
  findStoragePosition: () => findStoragePosition,
  formatDisplayNumber: () => formatDisplayNumber,
  insertBag: () => insertBag,
  insertBooking: () => insertBooking,
  insertBookingLine: () => insertBookingLine,
  insertException: () => insertException,
  insertGarment: () => insertGarment,
  insertPickupSession: () => insertPickupSession,
  insertReadyScanSession: () => insertReadyScanSession,
  insertStorageAssignment: () => insertStorageAssignment,
  insertTag: () => insertTag,
  listActiveStorageAssignments: () => listActiveStorageAssignments,
  listBookingLines: () => listBookingLines,
  listGarments: () => listGarments,
  loadBookingForUpdate: () => loadBookingForUpdate,
  loadPickupSessionForUpdate: () => loadPickupSessionForUpdate,
  loadReadyScanSessionForUpdate: () => loadReadyScanSessionForUpdate,
  nextBookingLocalSequence: () => nextBookingLocalSequence,
  setBagCustodyState: () => setBagCustodyState,
  setGarmentCustodyState: () => setGarmentCustodyState,
  updateBookingProjection: () => updateBookingProjection,
  updatePickupSession: () => updatePickupSession,
  updateReadyScanSession: () => updateReadyScanSession,
  voidTag: () => voidTag
});
var BOOKING_COLUMNS = `id, tenant_id, digital_store_id, location_id, booking_number,
  customer_id, status, to_char(business_date, 'YYYY-MM-DD') as business_date,
  currency_code, currency_exponent, subtotal_minor, discount_minor, tax_minor,
  total_minor, paid_minor, refunded_minor, balance_minor, due_at, pickup_method,
  config_snapshot_id, aggregate_version`;
async function loadBookingForUpdate(client, bookingId) {
  const result = await client.query(
    `select ${BOOKING_COLUMNS} from edge_laundry.booking where id = $1 for update`,
    [bookingId]
  );
  return result.rows[0];
}
async function findBooking(client, bookingId) {
  const result = await client.query(
    `select ${BOOKING_COLUMNS} from edge_laundry.booking where id = $1`,
    [bookingId]
  );
  return result.rows[0];
}
async function insertBooking(client, input) {
  await client.query(
    `insert into edge_laundry.booking
       (id, tenant_id, digital_store_id, location_id, booking_number, customer_id,
        status, business_date, currency_code, currency_exponent, subtotal_minor,
        discount_minor, tax_minor, total_minor, paid_minor, refunded_minor,
        balance_minor, due_at, pickup_method, config_snapshot_id, aggregate_version,
        created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14,
             0, 0, $14, $15, $16, $17, 1, now(), now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingNumber,
      input.customerId,
      input.status,
      input.businessDate,
      input.currencyCode,
      input.currencyExponent,
      input.subtotalMinor.toString(),
      input.discountMinor.toString(),
      input.taxMinor.toString(),
      input.totalMinor.toString(),
      input.dueAt,
      input.pickupMethod,
      input.configSnapshotId
    ]
  );
}
async function updateBookingProjection(client, input) {
  const result = await client.query(
    `update edge_laundry.booking
        set status         = coalesce($3, status),
            subtotal_minor = coalesce($4::bigint, subtotal_minor),
            discount_minor = coalesce($5::bigint, discount_minor),
            tax_minor      = coalesce($6::bigint, tax_minor),
            total_minor    = coalesce($7::bigint, total_minor),
            paid_minor     = coalesce($8::bigint, paid_minor),
            refunded_minor = coalesce($9::bigint, refunded_minor),
            due_at         = coalesce($10::timestamptz, due_at),
            balance_minor  = coalesce($7::bigint, total_minor)
                             - coalesce($8::bigint, paid_minor)
                             + coalesce($9::bigint, refunded_minor),
            aggregate_version = aggregate_version + 1
      where id = $1 and aggregate_version = $2
      returning aggregate_version`,
    [
      input.bookingId,
      input.expectedVersion.toString(),
      input.status ?? null,
      input.subtotalMinor?.toString() ?? null,
      input.discountMinor?.toString() ?? null,
      input.taxMinor?.toString() ?? null,
      input.totalMinor?.toString() ?? null,
      input.paidMinor?.toString() ?? null,
      input.refundedMinor?.toString() ?? null,
      input.dueAt ?? null
    ]
  );
  return result.rows[0]?.aggregate_version;
}
async function listBookingLines(client, bookingId) {
  const result = await client.query(
    `select id, booking_id, service_id, service_version, display_name, pricing_method,
            unit_price_minor, currency_code, currency_exponent, quantity::text as quantity,
            unit_code, line_subtotal_minor, discount_minor, tax_minor, line_total_minor
       from edge_laundry.booking_line where booking_id = $1 order by created_at, id`,
    [bookingId]
  );
  return result.rows;
}
async function insertBookingLine(client, input) {
  await client.query(
    `insert into edge_laundry.booking_line
       (id, tenant_id, digital_store_id, location_id, booking_id, service_id,
        service_version, display_name, pricing_method, unit_price_minor,
        currency_code, currency_exponent, quantity, unit_code, line_subtotal_minor,
        discount_minor, tax_minor, line_total_minor, addon_snapshot_json,
        source_config_version, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric,
             $14, $15, $16, $17, $18, $19::jsonb, $20, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.serviceId,
      input.serviceVersion.toString(),
      input.displayName,
      input.pricingMethod,
      input.unitPriceMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.quantity,
      input.unitCode,
      input.lineSubtotalMinor.toString(),
      input.discountMinor.toString(),
      input.taxMinor.toString(),
      input.lineTotalMinor.toString(),
      JSON.stringify(input.addonSnapshot),
      input.sourceConfigVersion.toString()
    ]
  );
}
async function deleteDraftBookingLines() {
  throw new Error(
    "edge_laundry.booking_line rows are never deleted (schema contract \xA71); supersede the draft instead."
  );
}
async function insertGarment(client, input) {
  await client.query(
    `insert into edge_laundry.garment
       (id, tenant_id, digital_store_id, location_id, booking_id, booking_line_id,
        garment_code, garment_type, color, condition_code, special_handling,
        current_custody_state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.bookingLineId,
      input.garmentCode,
      input.garmentType,
      input.color,
      input.conditionCode,
      input.specialHandling,
      input.custodyState
    ]
  );
}
async function listGarments(client, bookingId) {
  const result = await client.query(
    `select id, booking_id, garment_code, current_custody_state
       from edge_laundry.garment where booking_id = $1 order by created_at, id`,
    [bookingId]
  );
  return result.rows;
}
async function setGarmentCustodyState(client, garmentId, custodyState) {
  await client.query(`update edge_laundry.garment set current_custody_state = $2 where id = $1`, [
    garmentId,
    custodyState
  ]);
}
async function insertBag(client, input) {
  await client.query(
    `insert into edge_laundry.bag
       (id, tenant_id, digital_store_id, location_id, booking_id, bag_code,
        expected_piece_count, current_piece_count, current_custody_state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.bagCode,
      input.expectedPieceCount,
      input.currentPieceCount,
      input.custodyState
    ]
  );
}
async function setBagCustodyState(client, bagId, custodyState) {
  await client.query(`update edge_laundry.bag set current_custody_state = $2 where id = $1`, [
    bagId,
    custodyState
  ]);
}
async function insertTag(client, input) {
  await client.query(
    `insert into edge_laundry.tag
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        tag_code, tag_type, issued_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.tagCode,
      input.tagType
    ]
  );
}
async function voidTag(client, tagId, voidReason) {
  await client.query(
    `update edge_laundry.tag set voided_at = now(), void_reason = $2
      where id = $1 and voided_at is null`,
    [tagId, voidReason]
  );
}
async function appendStatusEvent(client, input) {
  await client.query(
    `insert into edge_laundry.status_event
       (id, tenant_id, digital_store_id, location_id, booking_id, from_status,
        to_status, reason_code, actor_id, terminal_device_id, occurred_at,
        local_sequence, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.fromStatus,
      input.toStatus,
      input.reasonCode,
      input.actorId,
      input.terminalDeviceId,
      input.localSequence.toString(),
      input.eventId
    ]
  );
}
async function appendCustodyEvent(client, input) {
  await client.query(
    `insert into edge_laundry.custody_event
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        event_type, from_custody_state, to_custody_state, storage_position_id,
        actor_id, terminal_device_id, session_id, occurred_at, local_sequence,
        reason_code, payload_sha256, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(),
             $15, $16, $17, $18)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.eventType,
      input.fromCustodyState,
      input.toCustodyState,
      input.storagePositionId,
      input.actorId,
      input.terminalDeviceId,
      input.sessionId,
      input.localSequence.toString(),
      input.reasonCode,
      input.payloadSha256,
      input.eventId
    ]
  );
}
async function nextBookingLocalSequence(client, table, bookingId) {
  const relation = table === "status_event" ? "edge_laundry.status_event" : "edge_laundry.custody_event";
  const result = await client.query(
    `select coalesce(max(local_sequence), 0) + 1 as next from ${relation} where booking_id = $1`,
    [bookingId]
  );
  return result.rows[0]?.next ?? 1n;
}
async function insertException(client, input) {
  await client.query(
    `insert into edge_laundry.exception
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        exception_type, severity, blocking, status, note, evidence_asset_id,
        created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.exceptionType,
      input.severity,
      input.blocking,
      input.status,
      input.note,
      input.evidenceAssetId,
      input.createdBy
    ]
  );
}
async function countBlockingExceptions(client, bookingId) {
  const result = await client.query(
    `select count(*)::text as count from edge_laundry.exception
      where booking_id = $1 and blocking and resolved_at is null`,
    [bookingId]
  );
  return Number(result.rows[0]?.count ?? "0");
}
async function findStoragePosition(client, positionId) {
  const result = await client.query(
    `select id, location_id, position_code, capacity, status, record_version
       from edge_laundry.storage_position where id = $1 for update`,
    [positionId]
  );
  return result.rows[0];
}
async function insertStorageAssignment(client, input) {
  await client.query(
    `insert into edge_laundry.storage_assignment
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        storage_position_id, assigned_at, assigned_by, terminal_device_id,
        assignment_event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.storagePositionId,
      input.assignedBy,
      input.terminalDeviceId,
      input.assignmentEventId
    ]
  );
}
async function listActiveStorageAssignments(client, bookingId) {
  const result = await client.query(
    `select id, booking_id, garment_id, bag_id, storage_position_id, cleared_at
       from edge_laundry.storage_assignment
      where booking_id = $1 and cleared_at is null
      order by assigned_at, id`,
    [bookingId]
  );
  return result.rows;
}
async function clearStorageAssignments(client, bookingId, clearedBy, clearReason) {
  const result = await client.query(
    `update edge_laundry.storage_assignment
        set cleared_at = now(), cleared_by = $2, clear_reason = $3
      where booking_id = $1 and cleared_at is null`,
    [bookingId, clearedBy, clearReason]
  );
  return result.rowCount ?? 0;
}
async function insertReadyScanSession(client, input) {
  await client.query(
    `insert into edge_laundry.ready_scan_session
       (id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
        actor_id, started_at, expected_count, scanned_count, qa_state, storage_state,
        status, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, now(), $8, 0, 'pending', 'unassigned',
             'in_progress', $9)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.terminalDeviceId,
      input.actorId,
      input.expectedCount,
      input.idempotencyKey
    ]
  );
}
async function loadReadyScanSessionForUpdate(client, sessionId) {
  const result = await client.query(
    `select id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
            actor_id, expected_count, scanned_count, qa_state, storage_state, status,
            idempotency_key, completed_at
       from edge_laundry.ready_scan_session where id = $1 for update`,
    [sessionId]
  );
  return result.rows[0];
}
async function updateReadyScanSession(client, input) {
  await client.query(
    `update edge_laundry.ready_scan_session
        set scanned_count = coalesce($2::integer, scanned_count),
            qa_state      = coalesce($3, qa_state),
            storage_state = coalesce($4, storage_state),
            status        = coalesce($5, status),
            completed_at  = case when $6::boolean then now() else completed_at end
      where id = $1`,
    [
      input.sessionId,
      input.scannedCount ?? null,
      input.qaState ?? null,
      input.storageState ?? null,
      input.status ?? null,
      input.completed ?? false
    ]
  );
}
async function insertPickupSession(client, input) {
  await client.query(
    `insert into edge_laundry.pickup_session
       (id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
        actor_id, started_at, expected_count, scanned_count, payment_gate_state,
        status, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, now(), $8, 0, $9, 'in_progress', $10)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.terminalDeviceId,
      input.actorId,
      input.expectedCount,
      input.paymentGateState,
      input.idempotencyKey
    ]
  );
}
async function loadPickupSessionForUpdate(client, sessionId) {
  const result = await client.query(
    `select id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
            actor_id, collector_verification_method, collector_verified_at,
            expected_count, scanned_count, payment_gate_state, completed_at, status,
            idempotency_key
       from edge_laundry.pickup_session where id = $1 for update`,
    [sessionId]
  );
  return result.rows[0];
}
async function updatePickupSession(client, input) {
  await client.query(
    `update edge_laundry.pickup_session
        set collector_verification_method = coalesce($2, collector_verification_method),
            collector_verified_at = case when $3::boolean then now()
                                         else collector_verified_at end,
            scanned_count = coalesce($4::integer, scanned_count),
            payment_gate_state = coalesce($5, payment_gate_state),
            status = coalesce($6, status),
            completed_at = case when $7::boolean then now() else completed_at end
      where id = $1`,
    [
      input.sessionId,
      input.collectorVerificationMethod ?? null,
      input.collectorVerified ?? false,
      input.scannedCount ?? null,
      input.paymentGateState ?? null,
      input.status ?? null,
      input.completed ?? false
    ]
  );
}
async function allocateBusinessNumber(client, locationId, sequenceCode, businessDate) {
  const result = await client.query(
    `select edge_core.allocate_business_number($1::uuid, $2::text, $3::date)`,
    [locationId, sequenceCode, businessDate]
  );
  return result.rows[0]?.allocate_business_number ?? 1n;
}
async function formatDisplayNumber(client, prefix, locationCode, businessDate, sequence) {
  const result = await client.query(
    `select edge_core.format_display_number($1::text, $2::text, $3::date, $4::bigint)`,
    [prefix, locationCode, businessDate, sequence.toString()]
  );
  const value = result.rows[0]?.format_display_number;
  if (value === void 0) {
    throw new Error("edge_core.format_display_number returned no row.");
  }
  return value;
}

// src/hub/repositories/payments.ts
var payments_exports = {};
__export(payments_exports, {
  advancePaymentState: () => advancePaymentState,
  findOpenShift: () => findOpenShift,
  findPaymentAttemptByRequestHash: () => findPaymentAttemptByRequestHash,
  insertCashMovement: () => insertCashMovement,
  insertPayment: () => insertPayment,
  insertPaymentAttempt: () => insertPaymentAttempt,
  insertRefundAdjustment: () => insertRefundAdjustment,
  insertTenderLeg: () => insertTenderLeg,
  listPaymentAttempts: () => listPaymentAttempts,
  listPayments: () => listPayments,
  listRefundAdjustments: () => listRefundAdjustments,
  loadPaymentForUpdate: () => loadPaymentForUpdate
});
var PAYMENT_COLUMNS = `id, tenant_id, digital_store_id, location_id, booking_id,
  payment_number, payment_type, amount_minor, currency_code, currency_exponent, state,
  provider_code, provider_reference, requested_at, confirmed_at, reversed_at, actor_id,
  terminal_device_id, event_id, idempotency_key`;
async function listPayments(client, bookingId) {
  const result = await client.query(
    `select ${PAYMENT_COLUMNS} from edge_payments.payment
      where booking_id = $1 order by requested_at, id`,
    [bookingId]
  );
  return result.rows;
}
async function loadPaymentForUpdate(client, paymentId) {
  const result = await client.query(
    `select ${PAYMENT_COLUMNS} from edge_payments.payment where id = $1 for update`,
    [paymentId]
  );
  return result.rows[0];
}
async function insertPayment(client, input) {
  await client.query(
    `insert into edge_payments.payment
       (id, tenant_id, digital_store_id, location_id, booking_id, payment_number,
        payment_type, amount_minor, currency_code, currency_exponent, state,
        provider_code, provider_reference, requested_at, confirmed_at, actor_id,
        terminal_device_id, event_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(),
             case when $14::boolean then now() else null end, $15, $16, $17, $18)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.paymentNumber,
      input.paymentType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.state,
      input.providerCode,
      input.providerReference,
      input.confirmed,
      input.actorId,
      input.terminalDeviceId,
      input.eventId,
      input.idempotencyKey
    ]
  );
}
async function advancePaymentState(client, input) {
  await client.query(
    `update edge_payments.payment
        set state = $2,
            confirmed_at = case when $3::boolean then coalesce(confirmed_at, now())
                                else confirmed_at end,
            provider_reference = coalesce($4, provider_reference)
      where id = $1`,
    [input.paymentId, input.state, input.confirm ?? false, input.providerReference ?? null]
  );
}
async function listPaymentAttempts(client, paymentId) {
  const result = await client.query(
    `select id, payment_id, attempt_number, request_sha256, provider_state,
            provider_reference, error_code, response_metadata
       from edge_payments.payment_attempt where payment_id = $1
      order by attempt_number`,
    [paymentId]
  );
  return result.rows;
}
async function findPaymentAttemptByRequestHash(client, paymentId, requestSha256) {
  const result = await client.query(
    `select id, payment_id, attempt_number, request_sha256, provider_state,
            provider_reference, error_code, response_metadata
       from edge_payments.payment_attempt
      where payment_id = $1 and request_sha256 = $2`,
    [paymentId, requestSha256]
  );
  return result.rows[0];
}
async function insertPaymentAttempt(client, input) {
  await client.query(
    `insert into edge_payments.payment_attempt
       (id, tenant_id, digital_store_id, location_id, payment_id, attempt_number,
        request_sha256, provider_state, provider_reference, requested_at,
        responded_at, error_code, response_metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(),
             case when $10::boolean then now() else null end, $11, $12::jsonb)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.paymentId,
      input.attemptNumber,
      input.requestSha256,
      input.providerState,
      input.providerReference,
      input.responded,
      input.errorCode,
      JSON.stringify(input.responseMetadata)
    ]
  );
}
async function insertTenderLeg(client, input) {
  await client.query(
    `insert into edge_payments.tender_leg
       (id, tenant_id, digital_store_id, location_id, payment_id, tender_type,
        amount_minor, currency_code, currency_exponent, state, provider_reference,
        event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.paymentId,
      input.tenderType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.state,
      input.providerReference,
      input.eventId
    ]
  );
}
async function listRefundAdjustments(client, bookingId) {
  const result = await client.query(
    `select id, booking_id, original_payment_id, adjustment_type, amount_minor,
            currency_code, currency_exponent, reason_code, approval_id, state, event_id
       from edge_payments.refund_adjustment where booking_id = $1
      order by created_at, id`,
    [bookingId]
  );
  return result.rows;
}
async function insertRefundAdjustment(client, input) {
  await client.query(
    `insert into edge_payments.refund_adjustment
       (id, tenant_id, digital_store_id, location_id, booking_id, original_payment_id,
        adjustment_type, amount_minor, currency_code, currency_exponent, reason_code,
        approval_id, state, created_at, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.originalPaymentId,
      input.adjustmentType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.reasonCode,
      input.approvalId,
      input.state,
      input.eventId
    ]
  );
}
async function findOpenShift(client, locationId, terminalDeviceId) {
  const result = await client.query(
    `select id, location_id, terminal_device_id, actor_id,
            to_char(business_date, 'YYYY-MM-DD') as business_date,
            currency_code, currency_exponent, status
       from edge_core.shift
      where location_id = $1 and terminal_device_id = $2 and closed_at is null
      order by opened_at desc limit 1`,
    [locationId, terminalDeviceId]
  );
  return result.rows[0];
}
async function insertCashMovement(client, input) {
  await client.query(
    `insert into edge_core.cash_movement
       (id, tenant_id, digital_store_id, location_id, shift_id, movement_type,
        amount_minor, currency_code, currency_exponent, reason_code,
        related_payment_id, actor_id, terminal_device_id, occurred_at, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.shiftId,
      input.movementType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.reasonCode,
      input.relatedPaymentId,
      input.actorId,
      input.terminalDeviceId,
      input.eventId
    ]
  );
}

// src/hub/repositories/index.ts
init_sync();

// src/hub/uuid.ts
import { randomBytes } from "node:crypto";
function uuidv7(now = Date.now()) {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  bytes[0] = Number(ms >> 40n & 0xffn);
  bytes[1] = Number(ms >> 32n & 0xffn);
  bytes[2] = Number(ms >> 24n & 0xffn);
  bytes[3] = Number(ms >> 16n & 0xffn);
  bytes[4] = Number(ms >> 8n & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6] ?? 0) & 15 | 112;
  bytes[8] = (bytes[8] ?? 0) & 63 | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
var UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isUuid(value) {
  return UUID_REGEX.test(value);
}

// src/hub/safety-mode.ts
var HUB_OPERATION_KINDS = [
  "read",
  /** An ordinary business mutation (Booking, custody, print queue, …). */
  "mutation",
  /** Finalized payment, cash, finance, custody or audit write (KLD-FIN-001). */
  "sensitive_write",
  /** A new large file entering the local file cache. */
  "large_file_write",
  /** Nonessential capture or export (photo capture, report export). */
  "nonessential_capture",
  /** Needs a payment/provider round trip. */
  "provider_dependent",
  /** Needs certificate validation, rotation or pairing. */
  "certificate_sensitive"
];
var MUTATING_OPERATION_KINDS = HUB_OPERATION_KINDS.filter(
  (kind) => kind !== "read"
);
var HUB_DISK_WATERMARKS = {
  watch: 70,
  degraded: 80,
  critical: 90,
  safetyReadOnlyRisk: 95
};
function diskBandFor(usedPercent) {
  if (!Number.isFinite(usedPercent)) {
    return "safety_read_only_risk";
  }
  if (usedPercent >= HUB_DISK_WATERMARKS.safetyReadOnlyRisk) return "safety_read_only_risk";
  if (usedPercent >= HUB_DISK_WATERMARKS.critical) return "critical";
  if (usedPercent >= HUB_DISK_WATERMARKS.degraded) return "degraded";
  if (usedPercent >= HUB_DISK_WATERMARKS.watch) return "watch";
  return "normal";
}
var CLOCK_WARNING_OFFSET_SECONDS = 300;
var CLOCK_BLOCKING_OFFSET_SECONDS = 1800;
function blockAll(refusals, mode, code, reason, evidence, kinds = MUTATING_OPERATION_KINDS) {
  for (const operation of kinds) {
    refusals.push({ operation, mode, code, reason, evidence });
  }
}
function diffMigrations(observation) {
  const applied = new Map(observation.applied.map((entry) => [entry.filename, entry]));
  const expected = new Map(observation.expected.map((entry) => [entry.filename, entry]));
  const missing = [];
  const checksumDrift = [];
  for (const [filename, entry] of expected) {
    const appliedEntry = applied.get(filename);
    if (!appliedEntry) {
      missing.push(filename);
      continue;
    }
    if (appliedEntry.checksumSha256 !== entry.checksumSha256) checksumDrift.push(filename);
  }
  const unexpected = [...applied.keys()].filter((filename) => !expected.has(filename));
  return {
    missing: missing.sort(),
    unexpected: unexpected.sort(),
    checksumDrift: checksumDrift.sort()
  };
}
function evaluateHubSafety(observations) {
  const findings = [];
  const refusals = [];
  if (observations.readOnlyDeclared) {
    const evidence = { reason: observations.readOnlyReason ?? "declared by operator/HET" };
    findings.push({
      mode: "hub_read_only",
      severity: "critical",
      detail: "Hub is in read-only safety mode; mutations are blocked and reads are preserved.",
      evidence
    });
    blockAll(
      refusals,
      "hub_read_only",
      "HUB_READ_ONLY",
      "the Store Hub is in read-only safety mode; no mutation is accepted until write health recovers.",
      evidence
    );
  }
  const migration = diffMigrations(observations.migration);
  if (migration.missing.length > 0 || migration.unexpected.length > 0 || migration.checksumDrift.length > 0) {
    const evidence = {
      missing_migrations: migration.missing,
      unexpected_migrations: migration.unexpected,
      checksum_drift: migration.checksumDrift,
      expected_count: observations.migration.expected.length,
      applied_count: observations.migration.applied.length
    };
    findings.push({
      mode: "migration_mismatch",
      severity: "critical",
      detail: "the applied migration set does not match the expected Hub schema version (schema contract \xA74; runbook \xA712).",
      evidence
    });
    blockAll(
      refusals,
      "migration_mismatch",
      "HUB_READ_ONLY",
      "the Hub schema does not match the expected migration set; mutations are refused until the schema is reconciled.",
      evidence
    );
  }
  if (observations.databaseIntegritySuspect) {
    const evidence = {
      finding: observations.databaseIntegrityFinding ?? "integrity check reported a suspicion",
      incident_code: "IR-DB"
    };
    findings.push({
      mode: "database_corruption_suspected",
      severity: "critical",
      detail: "local database corruption is suspected; sensitive writes are stopped (Part 18).",
      evidence
    });
    blockAll(
      refusals,
      "database_corruption_suspected",
      "HUB_READ_ONLY",
      "local database corruption is suspected; the Hub is in maintenance/read-only mode (runbook \xA711).",
      evidence
    );
  }
  if (!observations.configuration.compatible) {
    const evidence = {
      cfg_code: observations.configuration.cause ?? null,
      known_good_active: observations.configuration.knownGoodActive
    };
    findings.push({
      mode: "configuration_incompatible",
      // Part 18 keeps the Store running on the known-good package, so an
      // incompatible NEW package is degraded, not critical.
      severity: observations.configuration.knownGoodActive ? "degraded" : "critical",
      detail: observations.configuration.knownGoodActive ? "an incompatible configuration package was rejected; the Hub keeps the current known-good configuration (Part 18)." : "no compatible configuration is active; the Hub refuses to operate on unknown configuration.",
      evidence
    });
    if (!observations.configuration.knownGoodActive) {
      blockAll(
        refusals,
        "configuration_incompatible",
        "CONFIG_VERSION_INCOMPATIBLE",
        "no compatible configuration snapshot is active for this Location; the Hub refuses to guess configuration.",
        evidence
      );
    }
  }
  const diskBand = diskBandFor(observations.diskUsedPercent);
  if (diskBand !== "normal") {
    const evidence = { disk_used_percent: observations.diskUsedPercent, disk_band: diskBand };
    const severity = diskBand === "watch" ? "info" : diskBand === "degraded" ? "warning" : diskBand === "critical" ? "degraded" : "critical";
    findings.push({
      mode: "disk_pressure",
      severity,
      detail: `data-partition watermark band '${diskBand}' (file-cache protocol \xA713).`,
      evidence
    });
    if (diskBand === "critical" || diskBand === "safety_read_only_risk") {
      blockAll(
        refusals,
        "disk_pressure",
        "DEPENDENCY_UNAVAILABLE",
        "the Hub data partition is above the critical watermark; nonessential captures, exports and new large files are blocked so business evidence is preserved.",
        evidence,
        ["large_file_write", "nonessential_capture"]
      );
    }
    if (diskBand === "safety_read_only_risk") {
      blockAll(
        refusals,
        "disk_pressure",
        "HUB_READ_ONLY",
        "the Hub data partition is at the safety read-only watermark; unsafe mutations are blocked until space is recovered.",
        evidence,
        ["mutation", "sensitive_write", "provider_dependent", "certificate_sensitive"]
      );
    }
  }
  const offsetMagnitude = Math.abs(observations.clockOffsetSeconds);
  const trustedTimeRestored = observations.trustedTimeRestored === true;
  let clockLevel = "none";
  if (offsetMagnitude > CLOCK_BLOCKING_OFFSET_SECONDS && !trustedTimeRestored) {
    clockLevel = "blocking";
  } else if (offsetMagnitude > CLOCK_WARNING_OFFSET_SECONDS) {
    clockLevel = "warning";
  }
  if (clockLevel !== "none") {
    const evidence = {
      clock_offset_seconds: observations.clockOffsetSeconds,
      trusted_time_restored: trustedTimeRestored,
      // §16: "Local ordering still uses sequences" — never wall clock.
      local_ordering_source: "edge_sync.hub_sequence_seq"
    };
    findings.push({
      mode: "clock_anomaly",
      severity: clockLevel === "blocking" ? "critical" : "warning",
      detail: clockLevel === "blocking" ? "NTP offset exceeds 30 minutes and trusted time is not restored; provider-dependent and certificate-sensitive actions are blocked (\xA716)." : "NTP offset exceeds 5 minutes; a security/health event is recorded and the operator is warned (\xA716).",
      evidence
    });
    if (clockLevel === "blocking") {
      blockAll(
        refusals,
        "clock_anomaly",
        "DEPENDENCY_UNAVAILABLE",
        "trusted time is unavailable; provider-dependent and certificate-sensitive actions are blocked. Local ordering is unaffected because it uses sequences, never the wall clock.",
        evidence,
        ["provider_dependent", "certificate_sensitive"]
      );
    }
  }
  return {
    findings,
    refusals,
    diskBand,
    clock: {
      offsetSeconds: observations.clockOffsetSeconds,
      level: clockLevel,
      securityEventRequired: clockLevel !== "none"
    },
    degraded: findings.length > 0,
    readsPermitted: true
  };
}
async function readAppliedMigrations(client) {
  const result = await client.query(
    `select filename, checksum_sha256 from edge_ops.migration_journal order by filename`
  );
  return result.rows.map((row) => ({
    filename: row.filename,
    checksumSha256: row.checksum_sha256
  }));
}
async function readReportedClockOffsetSeconds(client, hubDeviceId2) {
  const result = await client.query(
    `select details_json ->> 'ntp_offset_seconds' as offset_seconds
       from edge_hardware.device_heartbeat
      where device_id = $1 and details_json ? 'ntp_offset_seconds'
      order by observed_at desc
      limit 1`,
    [hubDeviceId2]
  );
  const raw = result.rows[0]?.offset_seconds;
  if (raw === null || raw === void 0) return void 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : void 0;
}

// src/hub-runtime.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
var HUB_LAN_PORT = 7443;
var WILDCARD_BINDS = /* @__PURE__ */ new Set(["0.0.0.0", "::", "*", ""]);
function resolveBindHost(configured, interfaces = networkInterfaces()) {
  if (configured !== void 0 && configured.trim() !== "") {
    const value = configured.trim();
    if (WILDCARD_BINDS.has(value)) {
      return {
        kind: "refused",
        code: "KLUY-HUB-BIND-WILDCARD",
        detail: `HUB_LAN_BIND_HOST=${value} is a wildcard; the Store LAN listener binds one named interface (owner package \xA73)`
      };
    }
    return { kind: "resolved", bindHost: value, interfaceName: "configured" };
  }
  const candidates = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (/^(lo|docker|br-|veth|virbr|tailscale|wg)/.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }
  if (candidates.length === 0) {
    return {
      kind: "refused",
      code: "KLUY-HUB-BIND-NO-INTERFACE",
      detail: "no non-loopback IPv4 interface exists; a terminal would have nothing to dial"
    };
  }
  if (candidates.length > 1) {
    return {
      kind: "refused",
      code: "KLUY-HUB-BIND-AMBIGUOUS",
      detail: `more than one Store-LAN candidate (${candidates.map((c) => `${c.name}=${c.address}`).join(", ")}); set HUB_LAN_BIND_HOST explicitly rather than have the Hub guess which network the terminals are on`
    };
  }
  const only = candidates[0];
  return { kind: "resolved", bindHost: only.address, interfaceName: only.name };
}
function loadTlsMaterial(paths, read = (p) => readFileSync(p, "utf8"), exists = existsSync) {
  const missing = [];
  if (paths.keyPath === void 0 || paths.keyPath === "") missing.push("HUB_TLS_KEY_PATH");
  if (paths.certPath === void 0 || paths.certPath === "") missing.push("HUB_TLS_CERT_PATH");
  if (paths.clientCaPath === void 0 || paths.clientCaPath === "") {
    missing.push("HUB_DEVICE_CA_PATH");
  }
  if (missing.length > 0) {
    return {
      kind: "absent",
      code: "KLUY-HUB-TLS-UNCONFIGURED",
      detail: `no terminal-facing certificate material is configured (${missing.join(", ")}). Hub and device certificate issuance is BLK-005 and unanswered; nothing is generated here.`
    };
  }
  const unreadable = [paths.keyPath, paths.certPath, paths.clientCaPath].filter(
    (p) => !exists(p)
  );
  if (unreadable.length > 0) {
    return {
      kind: "absent",
      code: "KLUY-HUB-TLS-MISSING",
      detail: `configured certificate material does not exist: ${unreadable.join(", ")}`
    };
  }
  return {
    kind: "present",
    key: read(paths.keyPath),
    cert: read(paths.certPath),
    clientCa: read(paths.clientCaPath)
  };
}
function certificateFingerprint(certPem) {
  const body = certPem.replace(/-----BEGIN CERTIFICATE-----/g, "").replace(/-----END CERTIFICATE-----/g, "").replace(/\s+/g, "");
  return createHash2("sha256").update(Buffer.from(body, "base64")).digest("hex");
}
function evaluateSchema(expected, applied) {
  const appliedByName = new Map(applied.map((m) => [m.filename, m.checksumSha256]));
  const expectedByName = new Map(expected.map((m) => [m.filename, m.checksumSha256]));
  const drifted = expected.filter((m) => {
    const seen = appliedByName.get(m.filename);
    return seen !== void 0 && seen !== m.checksumSha256;
  });
  if (drifted.length > 0) {
    return {
      ok: false,
      code: "KLUY-HUB-SCHEMA-DRIFT",
      detail: `${drifted.length} applied migration(s) no longer match the bytes this release expects (${drifted.map((m) => m.filename).join(", ")}). An applied migration is never edited (schema contract \xA74).`
    };
  }
  const pending = expected.filter((m) => !appliedByName.has(m.filename));
  if (pending.length > 0) {
    return {
      ok: false,
      code: "KLUY-HUB-SCHEMA-PENDING",
      detail: `${pending.length} migration(s) are not applied (${pending[0].filename} first).`
    };
  }
  const unknown = applied.filter((m) => !expectedByName.has(m.filename));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "KLUY-HUB-SCHEMA-AHEAD",
      detail: `the database has ${unknown.length} migration(s) this release does not know (${unknown[0].filename} first); this Hub is older than its own database.`
    };
  }
  return { ok: true };
}
function evaluateStoragePosture(posture, environment) {
  if (posture === "DEVELOPMENT-UNBOUND" && environment !== "development") {
    return {
      ok: false,
      code: "KLUY-HUB-STORAGE-UNBOUND",
      detail: `the data volume was provisioned with a DEVELOPMENT-UNBOUND key and this Hub is running in "${environment}". That key is not bound to this board, so the volume is readable off it; a Store is not served from one. Program the board's OTP key and re-provision the volume.`
    };
  }
  return { ok: true };
}
function decideStartup(observations) {
  if (!observations.databaseReachable) {
    return {
      kind: "refuse",
      code: "KLUY-HUB-DB-UNREACHABLE",
      detail: "the local Hub database is not reachable; a Hub is the Store's authority and cannot serve without it"
    };
  }
  if (observations.storage !== void 0 && !observations.storage.ok) {
    return {
      kind: "refuse",
      code: observations.storage.code ?? "KLUY-HUB-STORAGE-REFUSED",
      detail: observations.storage.detail ?? "the Hub data volume is not acceptable for this environment"
    };
  }
  if (!observations.schema.ok) {
    return {
      kind: "refuse",
      code: observations.schema.code ?? "KLUY-HUB-SCHEMA-REFUSED",
      detail: observations.schema.detail ?? "the Hub schema is not the one this release expects"
    };
  }
  const assessment = evaluateHubSafety(observations.safety);
  if (observations.bind.kind === "refused") {
    return {
      kind: "refuse",
      code: observations.bind.code,
      detail: observations.bind.detail,
      assessment
    };
  }
  if (observations.tls.kind === "absent") {
    return {
      kind: "refuse",
      code: observations.tls.code,
      detail: observations.tls.detail,
      assessment
    };
  }
  return { kind: "serve", bindHost: observations.bind.bindHost, assessment };
}

// src/hub/edge/development-listener.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { createHash as createHash9, createPrivateKey as createPrivateKey2, createPublicKey as createPublicKey2, sign as cryptoSign } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";

// src/hub/pairing.ts
init_dist();
init_db();
init_audit();
import { randomUUID as randomUUID2, randomBytes as randomBytes2 } from "node:crypto";

// ../../packages/event-contracts/dist/index.js
var EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
var PAYLOAD_SHA256_PATTERN = /^[a-f0-9]{64}$/;
var MIN_SCHEMA_VERSION = 1;
function isValidEventName(name) {
  return EVENT_NAME_PATTERN.test(name);
}
function isValidSchemaVersion(version) {
  return typeof version === "number" && Number.isInteger(version) && version >= MIN_SCHEMA_VERSION;
}
function isValidPayloadChecksum(checksum) {
  return PAYLOAD_SHA256_PATTERN.test(checksum);
}
function validateEnvelope(envelope) {
  const violations = [];
  if (!isValidEventName(envelope.event_name)) {
    violations.push(`Invalid event_name "${envelope.event_name}"; expected <bounded_context>.<past_tense_fact> (two lowercase segments, no version suffix).`);
  }
  if (!isValidSchemaVersion(envelope.schema_version)) {
    violations.push(`Invalid schema_version ${String(envelope.schema_version)}; expected an integer >= ${MIN_SCHEMA_VERSION}.`);
  }
  if (!isValidPayloadChecksum(envelope.payload_sha256)) {
    violations.push(`Invalid payload_sha256 "${envelope.payload_sha256}"; expected 64 lowercase hex characters.`);
  }
  if (envelope.event_id.length === 0) {
    violations.push("Missing event_id; event identity is required and immutable.");
  }
  if (envelope.correlation_id.length === 0) {
    violations.push("Missing correlation_id; every event must be traceable to its cause chain.");
  }
  if (envelope.causation_id !== void 0 && envelope.causation_id !== null) {
    if (envelope.causation_id.length === 0) {
      violations.push("causation_id, when present, must be a non-empty event identity.");
    } else if (envelope.causation_id === envelope.event_id) {
      violations.push("causation_id must not reference the event's own event_id.");
    }
  }
  if (envelope.idempotency_key.length < 8 || envelope.idempotency_key.length > 200) {
    violations.push("idempotency_key must be between 8 and 200 characters.");
  }
  if (!isValidSchemaVersion(envelope.aggregate.version)) {
    violations.push(`Invalid aggregate.version ${String(envelope.aggregate.version)}; expected an integer >= 1.`);
  }
  if (envelope.replay !== void 0) {
    if (typeof envelope.replay.is_replay !== "boolean") {
      violations.push("replay.is_replay is required when replay metadata is present.");
    } else if (envelope.replay.is_replay && !envelope.replay.original_event_id) {
      violations.push("A replayed event must carry replay.original_event_id.");
    }
  }
  return violations;
}
function assertValidEnvelope(envelope) {
  const violations = validateEnvelope(envelope);
  if (violations.length > 0) {
    throw new Error(`Invalid domain event envelope: ${violations.join(" ")}`);
  }
}

// ../../packages/sync-protocol/dist/index.js
var UUID_PATTERN2 = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var HUB_EFFECT_KEY_PATTERN = /^kh1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,10}$/;
function buildHubEffectKey(commandResultId, eventOrdinal) {
  if (!UUID_PATTERN2.test(commandResultId)) {
    throw new Error(`Command result id must be a UUID (KLREQ-026); received '${commandResultId}'.`);
  }
  if (!Number.isSafeInteger(eventOrdinal) || eventOrdinal < 0 || eventOrdinal > 4294967295) {
    throw new Error("Event ordinal must be a non-negative 32-bit integer (KLREQ-026).");
  }
  return `kh1.${commandResultId}.${eventOrdinal}`;
}
function isValidHubEffectKey(key) {
  return HUB_EFFECT_KEY_PATTERN.test(key);
}

// src/hub/pairing-replication.ts
init_dist2();
init_errors();

// src/hub/outbox.ts
import { createHash as createHash5 } from "node:crypto";
init_dist2();
init_hub_database();

// src/hub/effect-contract.ts
init_errors();
var EFFECT_ORDINAL_STRIDE = 1e3;
var ADDITIONAL_COMMAND_EFFECTS = {
  // Confirm-intake takes custody of every registered unit and may settle a
  // deposit in the same command (Hub spec §8; laundry T1).
  "laundry.booking.confirm_intake": ["garment.custody_recorded", "payment.recorded"],
  // Confirm FROM A DRAFT (slice 2): the Booking fact (audit event, slot 0),
  // the cash payment, one fact per tender leg (KHR, USD), the drawer
  // movement when a shift is open, the receipt record, and the draft's own
  // conversion receipt for the cloud draft projection (T002 §8 census).
  // `payment.tender_recorded` and `document.receipt_issued` are PROPOSED
  // names (recorded in the slice-2 handoff for registration before release).
  "laundry.booking.confirm_from_draft": [
    "payment.recorded",
    "payment.tender_recorded",
    "cash.movement_recorded",
    "document.receipt_issued",
    "laundry.booking_draft_recorded"
  ],
  // T3: custody is taken at STORAGE ASSIGNMENT, not at the scan — the unit is
  // in Hub custody once it has a storage position, which is where
  // assignReadyStorage writes it.
  "laundry.ready.assign_storage": ["garment.custody_scanned_in"],
  // T4 scan-out releases custody per unit, written by completePickupSession.
  "laundry.pickup.complete": ["garment.custody_scanned_out"],
  // Pickup payment settles the balance and may move the cash drawer.
  "laundry.pickup.record_payment": ["payment.recorded", "cash.movement_recorded"],
  // Cash payment always writes the payment effect and the drawer movement.
  "payments.record_cash_payment": ["payment.recorded", "cash.movement_recorded"],
  "payments.create_pending_payment": ["payment.recorded"],
  "payments.request_refund": ["payment.recorded", "cash.movement_recorded"],
  "payments.request_void": ["payment.recorded"],
  "payments.apply_provider_callback": ["payment.recorded"]
};
function declaredEffects(definition) {
  const extra = ADDITIONAL_COMMAND_EFFECTS[definition.commandType] ?? [];
  const seen = /* @__PURE__ */ new Set([definition.auditEvent]);
  const effects = [definition.auditEvent];
  for (const name of extra) {
    if (seen.has(name)) continue;
    seen.add(name);
    effects.push(name);
  }
  return effects;
}
function assertDeclaredEffect(commandType, effects, eventName) {
  const slot = effects.indexOf(eventName);
  if (slot === -1) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Command '${commandType}' emitted the undeclared effect '${eventName}'. Declared effects: ${effects.join(", ")}. An unregistered effect fails rather than emits (KLREQ-026); declare it in ADDITIONAL_COMMAND_EFFECTS.`,
      { commandType, eventName, declared: effects }
    );
  }
  return slot;
}
function effectOrdinal(commandType, effects, eventName, occurrenceIndex) {
  const slot = assertDeclaredEffect(commandType, effects, eventName);
  if (occurrenceIndex < 0 || occurrenceIndex >= EFFECT_ORDINAL_STRIDE) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Effect '${eventName}' occurred ${occurrenceIndex + 1} times in one '${commandType}' command, past the ${EFFECT_ORDINAL_STRIDE} reserved per effect. Refusing rather than wrapping into the next effect's ordinal space.`,
      { commandType, eventName, occurrenceIndex }
    );
  }
  return slot * EFFECT_ORDINAL_STRIDE + occurrenceIndex;
}
function effectKey(input) {
  const ordinal = effectOrdinal(
    input.commandType,
    input.effects,
    input.eventName,
    input.occurrenceIndex
  );
  const key = buildHubEffectKey(input.commandResultId, ordinal);
  if (!isValidHubEffectKey(key)) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Derived effect key '${key}' is not the canonical kh1 shape (KLREQ-026).`,
      { commandResultId: input.commandResultId, ordinal }
    );
  }
  return key;
}

// src/hub/outbox.ts
function sha256Hex2(input) {
  return createHash5("sha256").update(input, "utf8").digest("hex");
}
function payloadChecksum(payload) {
  return sha256Hex2(canonicalJson(payload));
}
var HubEventRecorder = class {
  constructor(client, context) {
    this.client = client;
    this.context = context;
  }
  recorded = [];
  allocated = [];
  /** How many times each declared effect has been emitted by THIS command. */
  occurrences = /* @__PURE__ */ new Map();
  /** Every `hub_sequence` this command has taken from the allocator (offline §5). */
  get allocatedSequences() {
    return [...this.allocated];
  }
  get events() {
    return [...this.recorded];
  }
  get eventIds() {
    return this.recorded.map((e) => e.eventId);
  }
  get hubSequenceFirst() {
    return this.recorded[0]?.hubSequence ?? null;
  }
  get hubSequenceLast() {
    return this.recorded.at(-1)?.hubSequence ?? null;
  }
  /**
   * Allocate the sequence, build and VALIDATE the canonical envelope, then
   * write `local_event` + `edge_sync.outbox` in this transaction.
   */
  async record(input) {
    const hubSequence = await sync_exports.allocateHubSequence(this.client);
    this.allocated.push(hubSequence);
    const eventId = uuidv7();
    const occurrenceIndex = this.occurrences.get(input.eventName) ?? 0;
    this.occurrences.set(input.eventName, occurrenceIndex + 1);
    const idempotencyKey = effectKey({
      commandResultId: this.context.commandResultId,
      commandType: this.context.commandType,
      effects: this.context.declaredEffects,
      eventName: input.eventName,
      occurrenceIndex
    });
    const payloadSha256 = payloadChecksum(input.payload);
    const occurredAt = (/* @__PURE__ */ new Date()).toISOString();
    const envelope = {
      event_id: eventId,
      event_name: input.eventName,
      schema_version: input.schemaVersion ?? 1,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      tenant_id: this.context.tenantId,
      digital_store_id: this.context.digitalStoreId,
      location_id: this.context.locationId,
      aggregate: {
        type: input.aggregateType,
        id: input.aggregateId,
        version: Number(input.aggregateVersion)
      },
      producer: SERVICE_NAME,
      source: {
        source_type: "store_hub",
        source_id: this.context.hubDeviceId,
        device_id: this.context.originDeviceId,
        software_version: SERVICE_VERSION
      },
      actor: this.context.actorId === null ? null : { actor_type: this.context.actorType ?? "user", actor_id: this.context.actorId },
      correlation_id: asId.correlationId(this.context.correlationId),
      causation_id: input.causationId ?? this.recorded.at(-1)?.eventId ?? null,
      idempotency_key: asId.idempotencyKey(idempotencyKey),
      payload: input.payload,
      payload_sha256: payloadSha256,
      replay: { is_replay: false }
    };
    assertValidEnvelope(envelope);
    await sync_exports.insertLocalEventWithOutbox(this.client, {
      id: eventId,
      tenantId: this.context.tenantId,
      digitalStoreId: this.context.digitalStoreId,
      locationId: this.context.locationId,
      hubDeviceId: this.context.hubDeviceId,
      originDeviceId: this.context.originDeviceId,
      actorId: this.context.actorId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      eventType: input.eventName,
      schemaVersion: envelope.schema_version,
      businessDate: this.context.businessDate,
      hubSequence,
      originSequence: this.context.originSequence,
      assignmentGeneration: this.context.assignmentGeneration,
      idempotencyKey,
      payloadSha256,
      // The FULL canonical envelope is persisted so the outbox item is
      // self-contained for WS-10 transmission: `local_event` has no
      // correlation/causation/source/actor columns of its own.
      payload: envelope
    });
    const recorded = { eventId, hubSequence, idempotencyKey, envelope };
    this.recorded.push(recorded);
    return recorded;
  }
};

// src/hub/pairing-replication.ts
var PAIRING_RECEIPT_EVENT_NAME = "terminal_pairing.receipt_issued";
var PAIRING_RECEIPT_SCHEMA_VERSION = 1;
var PAIRING_RECEIPT_AGGREGATE_TYPE = "terminal_pairing";
var HUB_ORIGINATED_EFFECT_ORDINALS = {
  [PAIRING_RECEIPT_EVENT_NAME]: 1
};
function pairingReceiptEffectKey(receiptId, eventName) {
  const ordinal = HUB_ORIGINATED_EFFECT_ORDINALS[eventName];
  if (ordinal === void 0) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Hub-originated effect '${eventName}' has no registered ordinal. An unregistered ordinal fails rather than emits (KLREQ-026).`,
      { eventName }
    );
  }
  const key = buildHubEffectKey(receiptId, ordinal);
  if (!isValidHubEffectKey(key)) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Derived effect key '${key}' is not the canonical kh1 shape (KLREQ-026).`,
      { receiptId, ordinal }
    );
  }
  return key;
}
var FORBIDDEN_PAYLOAD_KEY_FRAGMENTS = [
  "nonce",
  "privatekey",
  "proofsignature",
  "provisioningcode",
  "codedigest",
  "password",
  "secret",
  "connectionstring"
];
var FORBIDDEN_PAYLOAD_VALUE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|postgres(?:ql)?:\/\//;
function assertPublishableReceiptPayload(payload) {
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_PAYLOAD_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        `Field '${key}' must never be replicated to cloud: nonces, ephemeral proof signatures, provisioning codes, private keys and database credentials stay on the Hub (P04C \xA722).`,
        { field: key }
      );
    }
    if (typeof value === "string" && FORBIDDEN_PAYLOAD_VALUE.test(value)) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        `Field '${key}' carries private key material or a database credential; refusing to replicate it (P04C \xA722).`,
        { field: key }
      );
    }
  }
}
async function recordPairingReceiptEvent(client, input) {
  const payload = { ...input.payload };
  assertPublishableReceiptPayload(payload);
  const idempotencyKey = pairingReceiptEffectKey(
    input.payload.receipt_id,
    PAIRING_RECEIPT_EVENT_NAME
  );
  const hubSequence = await sync_exports.allocateHubSequence(client);
  const payloadSha256 = payloadChecksum(payload);
  const occurredAt = input.payload.paired_at;
  const envelope = {
    event_id: input.eventId,
    event_name: PAIRING_RECEIPT_EVENT_NAME,
    schema_version: PAIRING_RECEIPT_SCHEMA_VERSION,
    occurred_at: occurredAt,
    recorded_at: (/* @__PURE__ */ new Date()).toISOString(),
    tenant_id: input.payload.tenant_id,
    digital_store_id: input.payload.digital_store_id,
    location_id: input.payload.location_id,
    aggregate: {
      type: PAIRING_RECEIPT_AGGREGATE_TYPE,
      id: input.payload.pairing_session_id,
      version: 1
    },
    producer: SERVICE_NAME,
    source: {
      source_type: "store_hub",
      source_id: input.payload.hub_device_id,
      device_id: input.payload.terminal_device_id,
      software_version: SERVICE_VERSION
    },
    // Pairing is a DEVICE fact: no staff actor performs it, and naming one
    // would be a fabricated attribution in an append-only record.
    actor: null,
    correlation_id: asId.correlationId(input.payload.correlation_id),
    causation_id: null,
    idempotency_key: asId.idempotencyKey(idempotencyKey),
    payload,
    payload_sha256: payloadSha256,
    replay: { is_replay: false }
  };
  assertValidEnvelope(envelope);
  await sync_exports.insertLocalEventWithOutbox(client, {
    id: input.eventId,
    tenantId: input.payload.tenant_id,
    digitalStoreId: input.payload.digital_store_id,
    locationId: input.payload.location_id,
    hubDeviceId: input.payload.hub_device_id,
    originDeviceId: input.payload.terminal_device_id,
    actorId: null,
    aggregateType: PAIRING_RECEIPT_AGGREGATE_TYPE,
    aggregateId: input.payload.pairing_session_id,
    aggregateVersion: 1n,
    eventType: PAIRING_RECEIPT_EVENT_NAME,
    schemaVersion: PAIRING_RECEIPT_SCHEMA_VERSION,
    businessDate: input.businessDate,
    hubSequence,
    // A Hub-originated fact has no terminal sequence. Zero is the contract's
    // "no origin sequence" value (`local_event_origin_sequence_ck` admits it),
    // not a claim that some terminal command numbered zero produced this.
    originSequence: 0n,
    assignmentGeneration: input.hubAssignmentGeneration,
    idempotencyKey,
    payloadSha256,
    payload: envelope
  });
  return { eventId: input.eventId, hubSequence, idempotencyKey, envelope };
}

// src/hub/pairing.ts
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HEX642 = /^[0-9a-f]{64}$/;
var PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
var MAX_SIGNATURE_BASE64 = 128;
function mapSentinel(message) {
  const families = [
    ["KLUY-EDGE-PAIRING-VERSION-INCOMPATIBLE", "PAIR_VERSION_INCOMPATIBLE"],
    ["KLUY-EDGE-PAIRING-ASSIGNMENT-MISMATCH", "PAIR_ASSIGNMENT_MISMATCH"],
    ["KLUY-EDGE-PAIRING-CERT-INVALID", "PAIR_CERT_INVALID"],
    ["KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE", "PAIR_HUB_NOT_ACTIVE"],
    ["KLUY-EDGE-PAIRING-DEVICE-NOT-ELIGIBLE", "PAIR_DEVICE_NOT_ELIGIBLE"],
    ["KLUY-EDGE-PAIRING-PROFILE-FORBIDDEN", "PAIR_PROFILE_FORBIDDEN"],
    ["KLUY-EDGE-PAIRING-PROOF-INVALID", "PAIR_CHALLENGE_FAILED"],
    ["KLUY-EDGE-PAIRING-PROOF-REQUIRED", "PAIR_PROOF_REQUIRED"],
    ["KLUY-EDGE-PAIRING-EXPIRED", "PAIR_CHALLENGE_EXPIRED"],
    ["KLUY-EDGE-PAIRING-EXPIRY", "PAIR_CHALLENGE_EXPIRED"],
    ["KLUY-EDGE-PAIRING-NONCE", "PAIR_NONCE_REJECTED"],
    ["KLUY-EDGE-PAIRING-SESSION-OUTSTANDING", "PAIR_SESSION_OUTSTANDING"],
    ["KLUY-EDGE-PAIRING-SESSION-UNKNOWN", "PAIR_SESSION_UNKNOWN"],
    ["KLUY-EDGE-PAIRING-CONSUMED", "PAIR_SESSION_CONSUMED"],
    ["KLUY-EDGE-PAIRING-TRANSCRIPT-CONFLICT", "PAIR_TRANSCRIPT_CONFLICT"],
    ["KLUY-EDGE-PAIRING-REQUEST", "REQUEST_INVALID"]
  ];
  for (const [sentinel, code] of families) {
    if (message.includes(sentinel)) return code;
  }
  return "INTERNAL_ERROR";
}
var NO_LOG = { info: () => void 0 };
var SESSION_COLUMNS = `
  s.id, s.protocol_version, s.purpose, s.tenant_id, s.digital_store_id,
  s.location_id, s.environment, s.hub_device_id, s.hub_assignment_generation,
  s.hub_certificate_serial, s.hub_certificate_fingerprint, s.terminal_device_id,
  s.terminal_assignment_generation, s.terminal_profile_code,
  s.terminal_certificate_serial, s.terminal_certificate_fingerprint,
  s.terminal_nonce, s.hub_nonce, s.state, s.transcript_hash,
  s.created_at::text as created_text, s.expires_at::text as expires_text,
  now()::text as now_text`;
async function readSession(client, sessionId) {
  const result = await client.query(
    `select ${SESSION_COLUMNS} from edge_identity.pairing_session s where s.id = $1`,
    [sessionId]
  );
  return result.rows[0] ?? null;
}
function transcriptFromRow(row) {
  return {
    pairingSessionId: row.id,
    protocolVersion: row.protocol_version,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment,
    hubDeviceId: row.hub_device_id,
    hubAssignmentGeneration: Number(row.hub_assignment_generation),
    hubCertificateSerial: row.hub_certificate_serial,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    terminalCertificateSerial: row.terminal_certificate_serial,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    terminalNonce: row.terminal_nonce,
    hubNonce: row.hub_nonce,
    issuedAt: new Date(row.created_text),
    expiresAt: new Date(row.expires_text)
  };
}
function expectationFromRow(row, signerKeyFingerprint) {
  return {
    pairingSessionId: row.id,
    protocolVersion: row.protocol_version,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment,
    hubDeviceId: row.hub_device_id,
    hubAssignmentGeneration: Number(row.hub_assignment_generation),
    hubCertificateSerial: row.hub_certificate_serial,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    terminalCertificateSerial: row.terminal_certificate_serial,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    signerKeyFingerprint,
    terminalNonce: row.terminal_nonce,
    hubNonce: row.hub_nonce
  };
}
function challengeFromRow(row) {
  return {
    pairingSessionId: row.id,
    protocolVersion: row.protocol_version,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment,
    hubDeviceId: row.hub_device_id,
    hubAssignmentGeneration: Number(row.hub_assignment_generation),
    hubCertificateSerial: row.hub_certificate_serial,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    terminalCertificateSerial: row.terminal_certificate_serial,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    terminalNonce: row.terminal_nonce,
    hubNonce: row.hub_nonce,
    issuedAt: row.created_text,
    expiresAt: row.expires_text
  };
}
var RECEIPT_COLUMNS = `
  r.id, r.receipt_version, r.pairing_session_id, r.transcript_hash,
  r.hub_device_id, r.hub_certificate_fingerprint, r.terminal_device_id,
  r.terminal_certificate_fingerprint, r.tenant_id, r.digital_store_id,
  r.location_id, r.environment, r.terminal_assignment_generation,
  r.terminal_profile_code, r.signature_b64, r.correlation_id,
  r.paired_at::text as paired_text, r.valid_until::text as valid_text`;
function receiptFromRow(row) {
  return {
    receiptId: row.id,
    receiptVersion: row.receipt_version,
    pairingSessionId: row.pairing_session_id,
    transcriptHash: row.transcript_hash,
    hubDeviceId: row.hub_device_id,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    pairedAt: new Date(row.paired_text),
    validUntil: row.valid_text === null ? null : new Date(row.valid_text),
    correlationId: row.correlation_id
  };
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
var TerminalPairingComposition = class {
  constructor(pool, signer, logger = NO_LOG) {
    this.pool = pool;
    this.signer = signer;
    this.logger = logger;
  }
  /**
   * §8.1-§8.2: accepts a terminal hello and opens the governed handshake.
   * The Hub nonce comes from the sanctioned random authority (node:crypto —
   * the Hub database has no pgcrypto); every identity, scope, generation and
   * credential binding is derived by the door from authoritative rows. The
   * expiry is caller-bounded because the protocol defines no lifetime; the
   * door caps it at both credentials' expiry and the production default
   * remains [REQUIRED: pairing_challenge_lifetime].
   */
  async preparePairing(input) {
    const correlationId = randomUUID2();
    if (!UUID2.test(input.terminalDeviceId) || !PROFILE.test(input.requestedProfileCode) || !HEX642.test(input.terminalNonce)) {
      this.logger.info({ operation: "preparePairing", correlationId, result: "REQUEST_INVALID" });
      return { result: "REQUEST_INVALID", correlationId };
    }
    const sessionId = randomUUID2();
    const hubNonce = randomBytes2(32).toString("hex");
    try {
      const row = await withHubTransaction(
        this.pool,
        async (client) => {
          const created = await client.query(
            `select (edge_identity.begin_terminal_pairing_v1(
               $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, $9::uuid)).id as id`,
            [
              sessionId,
              input.terminalDeviceId,
              input.requestedProfileCode,
              input.terminalNonce,
              hubNonce,
              input.protocolVersion,
              input.environment,
              input.expiresAt.toISOString(),
              correlationId
            ]
          );
          return readSession(client, String(created.rows[0]?.id));
        },
        HUB_RUNTIME_ROLE
      );
      if (row === null) {
        this.logger.info({ operation: "preparePairing", correlationId, result: "INTERNAL_ERROR" });
        return { result: "INTERNAL_ERROR", correlationId };
      }
      this.logger.info({ operation: "preparePairing", correlationId, result: "PAIRING_PREPARED" });
      return { result: "PAIRING_PREPARED", correlationId, data: challengeFromRow(row) };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "preparePairing", correlationId, result });
      return { result, correlationId };
    }
  }
  /**
   * §8.3 first half: verifies the terminal's proof against the AUTHORITATIVE
   * session row under Hub-local time, then records the attestation through
   * the governed door. A failed proof consumes nothing, and the refusal is
   * recorded as security evidence in its own transaction — a blocked attempt
   * is EVIDENCE, never a silent drop.
   */
  async verifyTerminalProofAndRecord(input) {
    const correlationId = randomUUID2();
    if (!UUID2.test(input.pairingSessionId) || input.signatureBase64.length === 0 || input.signatureBase64.length > MAX_SIGNATURE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(input.signatureBase64) || !input.terminalPublicKeyPem.includes("BEGIN PUBLIC KEY")) {
      this.logger.info({
        operation: "verifyTerminalProofAndRecord",
        correlationId,
        result: "REQUEST_INVALID"
      });
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const outcome = await withHubTransaction(
        this.pool,
        async (client) => {
          const row = await readSession(client, input.pairingSessionId);
          if (row === null) return { result: "PAIR_SESSION_UNKNOWN" };
          if (row.state === "terminal_proof_verified") {
            return {
              result: "TERMINAL_PROOF_RECORDED",
              transcriptHash: pairingTranscriptHash(transcriptFromRow(row))
            };
          }
          if (row.state !== "challenge_issued") {
            return { result: "PAIR_SESSION_CONSUMED" };
          }
          const transcript = transcriptFromRow(row);
          const verdict = verifyTerminalPairingProof(
            transcript,
            Buffer.from(input.signatureBase64, "base64"),
            input.terminalPublicKeyPem,
            expectationFromRow(row, row.terminal_certificate_fingerprint),
            new Date(row.now_text),
            publicKeyFingerprint
          );
          if (!verdict.verified) {
            return {
              result: verdict.refusalCode === "PAIR_CHALLENGE_EXPIRED" ? "PAIR_CHALLENGE_EXPIRED" : "PAIR_CHALLENGE_FAILED",
              row
            };
          }
          await client.query(
            `select edge_identity.record_terminal_pairing_proof_v1($1::uuid, true, $2::uuid)`,
            [input.pairingSessionId, correlationId]
          );
          return {
            result: "TERMINAL_PROOF_RECORDED",
            transcriptHash: verdict.transcriptHash ?? ""
          };
        },
        HUB_RUNTIME_ROLE
      );
      if (outcome.result === "PAIR_CHALLENGE_FAILED" || outcome.result === "PAIR_CHALLENGE_EXPIRED") {
        const row = "row" in outcome ? outcome.row : null;
        await withHubTransaction(
          this.pool,
          (client) => recordSecurityEvent(client, {
            id: randomUUID2(),
            tenantId: row?.tenant_id ?? null,
            digitalStoreId: row?.digital_store_id ?? null,
            locationId: row?.location_id ?? null,
            eventCode: "EDGE_PAIRING_PROOF_REJECTED",
            severity: "medium",
            deviceId: row?.terminal_device_id ?? null,
            certificateSerial: row?.terminal_certificate_serial ?? null,
            details: { correlationId, refusal: outcome.result }
          }),
          HUB_RUNTIME_ROLE
        ).catch(() => void 0);
      }
      const data = outcome.result === "TERMINAL_PROOF_RECORDED" ? { transcriptHash: outcome.transcriptHash } : void 0;
      this.logger.info({
        operation: "verifyTerminalProofAndRecord",
        correlationId,
        result: outcome.result
      });
      return { result: outcome.result, correlationId, data };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "verifyTerminalProofAndRecord", correlationId, result });
      return { result, correlationId };
    }
  }
  /**
   * §8.3 second half and §9: produces the Hub proof, issues the ONE
   * Hub-signed receipt through the completion door, and appends the
   * `device.paired` audit fact — all in one transaction, under one
   * transaction-stable `now()`, so the signed receipt and the stored row
   * carry the identical instant. A replay returns the ORIGINAL receipt.
   */
  async produceHubProofAndComplete(input) {
    const correlationId = randomUUID2();
    if (!UUID2.test(input.pairingSessionId)) {
      this.logger.info({
        operation: "produceHubProofAndComplete",
        correlationId,
        result: "REQUEST_INVALID"
      });
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const outcome = await withHubTransaction(
        this.pool,
        async (client) => {
          const row = await readSession(client, input.pairingSessionId);
          if (row === null) return { result: "PAIR_SESSION_UNKNOWN" };
          if (row.state === "paired") {
            const existing = await client.query(
              `select ${RECEIPT_COLUMNS} from edge_identity.pairing_receipt r
                where r.pairing_session_id = $1`,
              [row.id]
            );
            const receiptRow = existing.rows[0];
            if (receiptRow === void 0) return { result: "INTERNAL_ERROR" };
            const transcript2 = transcriptFromRow(row);
            return {
              result: "ALREADY_PAIRED",
              state: {
                pairingSessionId: row.id,
                receiptId: receiptRow.id,
                transcriptHash: receiptRow.transcript_hash,
                receipt: receiptFromRow(receiptRow),
                receiptSignatureBase64: receiptRow.signature_b64,
                hubProofSignatureBase64: Buffer.from(
                  this.signer.sign(hubPairingProofBytes(transcript2))
                ).toString("base64"),
                pairedAt: receiptRow.paired_text
              }
            };
          }
          if (row.state !== "terminal_proof_verified") {
            return { result: "PAIR_PROOF_REQUIRED" };
          }
          const transcript = transcriptFromRow(row);
          const transcriptHash = pairingTranscriptHash(transcript);
          const hubProofSignature = this.signer.sign(hubPairingProofBytes(transcript));
          const receiptId = randomUUID2();
          const receipt = {
            receiptId,
            receiptVersion: PAIRING_PROTOCOL_VERSION,
            pairingSessionId: row.id,
            transcriptHash,
            hubDeviceId: row.hub_device_id,
            hubCertificateFingerprint: row.hub_certificate_fingerprint,
            terminalDeviceId: row.terminal_device_id,
            terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
            tenantId: row.tenant_id,
            digitalStoreId: row.digital_store_id,
            storeLocationId: row.location_id,
            environment: row.environment,
            terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
            terminalProfileKey: row.terminal_profile_code,
            pairedAt: new Date(row.now_text),
            validUntil: null,
            correlationId
          };
          const receiptSignature = this.signer.sign(pairingReceiptBytes(receipt));
          const completed2 = await client.query(
            `select (edge_identity.complete_terminal_pairing_v1(
               $1::uuid, $2, $3::uuid, $4, $5, null, $6::uuid)).id as id`,
            [
              row.id,
              transcriptHash,
              receiptId,
              Buffer.from(receiptSignature).toString("base64"),
              this.signer.certificateSerial,
              correlationId
            ]
          );
          const storedId = String(completed2.rows[0]?.id);
          const seq = await client.query(
            `select nextval('edge_sync.hub_sequence_seq')::text as next`
          );
          await appendAuditEvent(client, {
            id: randomUUID2(),
            tenantId: row.tenant_id,
            digitalStoreId: row.digital_store_id,
            locationId: row.location_id,
            eventCode: "device.paired",
            actorType: "device",
            actorId: null,
            requesterId: null,
            approverId: null,
            terminalDeviceId: row.terminal_device_id,
            hubDeviceId: row.hub_device_id,
            profileCode: row.terminal_profile_code,
            resourceType: "pairing_session",
            resourceId: row.id,
            reasonCode: null,
            correlationId,
            payloadSha256: transcriptHash,
            details: { receiptId: storedId, protocolVersion: row.protocol_version },
            localSequence: BigInt(seq.rows[0]?.next ?? "0")
          });
          await recordPairingReceiptEvent(client, {
            eventId: randomUUID2(),
            hubAssignmentGeneration: Number(row.hub_assignment_generation),
            // The SAME transaction-stable `now()` the receipt carries, so the
            // business date can never belong to a different day than the fact.
            businessDate: row.now_text.slice(0, 10),
            payload: {
              receipt_id: storedId,
              receipt_version: receipt.receiptVersion,
              pairing_session_id: row.id,
              hub_device_id: row.hub_device_id,
              terminal_device_id: row.terminal_device_id,
              terminal_assignment_generation: Number(row.terminal_assignment_generation),
              terminal_profile_code: row.terminal_profile_code,
              tenant_id: row.tenant_id,
              digital_store_id: row.digital_store_id,
              location_id: row.location_id,
              environment: row.environment,
              hub_certificate_fingerprint: row.hub_certificate_fingerprint,
              terminal_certificate_fingerprint: row.terminal_certificate_fingerprint,
              transcript_hash: transcriptHash,
              paired_at: receipt.pairedAt.toISOString(),
              hub_receipt_signature: Buffer.from(receiptSignature).toString("base64"),
              hub_certificate_serial: this.signer.certificateSerial,
              correlation_id: correlationId
            }
          });
          return {
            result: "PAIRED",
            state: {
              pairingSessionId: row.id,
              receiptId: storedId,
              transcriptHash,
              receipt,
              receiptSignatureBase64: Buffer.from(receiptSignature).toString("base64"),
              hubProofSignatureBase64: Buffer.from(hubProofSignature).toString("base64"),
              pairedAt: receipt.pairedAt.toISOString()
            }
          };
        },
        HUB_RUNTIME_ROLE
      );
      const data = "state" in outcome ? outcome.state : void 0;
      this.logger.info({
        operation: "produceHubProofAndComplete",
        correlationId,
        result: outcome.result
      });
      return { result: outcome.result, correlationId, data };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      if (result === "PAIR_SESSION_CONSUMED" || result === "INTERNAL_ERROR") {
        const recovered = await this.recoverPairedState(input.pairingSessionId).catch(() => null);
        if (recovered !== null) {
          this.logger.info({
            operation: "produceHubProofAndComplete",
            correlationId,
            result: "ALREADY_PAIRED"
          });
          return { result: "ALREADY_PAIRED", correlationId, data: recovered };
        }
      }
      this.logger.info({ operation: "produceHubProofAndComplete", correlationId, result });
      return { result, correlationId };
    }
  }
  /**
   * T007 D1: the completion loser's recovery read. Returns the paired state
   * ONLY when the session is authoritatively 'paired' with its single
   * stored receipt; anything else returns null and the caller keeps the
   * mapped refusal.
   */
  async recoverPairedState(pairingSessionId) {
    return withHubTransaction(
      this.pool,
      async (client) => {
        const row = await readSession(client, pairingSessionId);
        if (row === null || row.state !== "paired") return null;
        const existing = await client.query(
          `select ${RECEIPT_COLUMNS} from edge_identity.pairing_receipt r
            where r.pairing_session_id = $1`,
          [row.id]
        );
        const receiptRow = existing.rows[0];
        if (receiptRow === void 0) return null;
        const transcript = transcriptFromRow(row);
        return {
          pairingSessionId: row.id,
          receiptId: receiptRow.id,
          transcriptHash: receiptRow.transcript_hash,
          receipt: receiptFromRow(receiptRow),
          receiptSignatureBase64: receiptRow.signature_b64,
          hubProofSignatureBase64: Buffer.from(
            this.signer.sign(hubPairingProofBytes(transcript))
          ).toString("base64"),
          pairedAt: receiptRow.paired_text
        };
      },
      HUB_RUNTIME_ROLE
    );
  }
  /** Replay/reconciliation: the stored receipt answers, byte-for-byte. */
  async reconcilePairingReceipt(input) {
    const correlationId = randomUUID2();
    if (!UUID2.test(input.pairingSessionId)) {
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const receiptRow = await withHubTransaction(
        this.pool,
        async (client) => {
          const result = await client.query(
            `select ${RECEIPT_COLUMNS} from edge_identity.pairing_receipt r
              where r.pairing_session_id = $1`,
            [input.pairingSessionId]
          );
          return result.rows[0] ?? null;
        },
        HUB_RUNTIME_ROLE
      );
      if (receiptRow === null) {
        this.logger.info({
          operation: "reconcilePairingReceipt",
          correlationId,
          result: "RECEIPT_NOT_FOUND"
        });
        return { result: "RECEIPT_NOT_FOUND", correlationId };
      }
      this.logger.info({
        operation: "reconcilePairingReceipt",
        correlationId,
        result: "RECEIPT_FOUND"
      });
      return {
        result: "RECEIPT_FOUND",
        correlationId,
        data: {
          receiptId: receiptRow.id,
          pairingSessionId: receiptRow.pairing_session_id,
          transcriptHash: receiptRow.transcript_hash,
          receipt: receiptFromRow(receiptRow),
          receiptSignatureBase64: receiptRow.signature_b64,
          pairedAt: receiptRow.paired_text
        }
      };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "reconcilePairingReceipt", correlationId, result });
      return { result, correlationId };
    }
  }
};

// src/hub/edge/discovery.ts
init_dist();
import { randomUUID as randomUUID3 } from "node:crypto";
var NO_LOG2 = { info: () => void 0 };
var EdgeDiscoveryAuthority = class {
  constructor(identity, signer, logger = NO_LOG2, now = () => /* @__PURE__ */ new Date()) {
    this.identity = identity;
    this.signer = signer;
    this.logger = logger;
    this.now = now;
  }
  current = null;
  /**
   * The live signed record, re-minted when older than the 30-second refresh
   * or within 5 s of expiry. A refresh changes the record id and instants —
   * never the Hub identity, fingerprint or scope.
   */
  currentSignedRecord() {
    const nowMs = this.now().getTime();
    const live = this.current;
    if (live !== null && nowMs - live.record.issuedAt.getTime() < EDGE_DISCOVERY_REFRESH_SECONDS * 1e3 && live.record.expiresAt.getTime() - nowMs > 5e3) {
      return live;
    }
    const issuedAt = new Date(nowMs);
    const record = {
      protocolVersion: EDGE_DISCOVERY_KIND,
      recordId: randomUUID3(),
      hubDeviceId: this.identity.hubDeviceId,
      hubCertificateFingerprint: this.identity.hubTlsCertificateFingerprint,
      tenantId: this.identity.tenantId,
      digitalStoreId: this.identity.digitalStoreId,
      storeLocationId: this.identity.storeLocationId,
      environment: this.identity.environment,
      hostname: this.identity.hostname,
      port: this.identity.port ?? EDGE_LAN_PORT,
      issuedAt,
      expiresAt: new Date(nowMs + EDGE_DISCOVERY_VALIDITY_SECONDS * 1e3)
    };
    const signatureBase64Url = Buffer.from(
      this.signer.sign(edgeDiscoveryRecordBytes(record))
    ).toString("base64url");
    this.current = { record, signatureBase64Url };
    this.logger.info({
      operation: "discoveryRecordMinted",
      correlationId: record.recordId,
      result: "SIGNED"
    });
    return this.current;
  }
  /** The `GET /.well-known/kitluy-edge-discovery/v1` body. */
  wellKnownPayload() {
    const { record, signatureBase64Url } = this.currentSignedRecord();
    return {
      record: {
        protocolVersion: record.protocolVersion,
        recordId: record.recordId,
        hubDeviceId: record.hubDeviceId,
        hubCertificateFingerprint: record.hubCertificateFingerprint,
        tenantId: record.tenantId,
        digitalStoreId: record.digitalStoreId,
        storeLocationId: record.storeLocationId,
        environment: record.environment,
        hostname: record.hostname,
        port: record.port,
        issuedAt: record.issuedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString()
      },
      signature: signatureBase64Url,
      signatureAlgorithm: "ed25519"
    };
  }
  /** The unsigned multicast hint for `_kitluy-edge._tcp.local`. */
  announcement() {
    const { record } = this.currentSignedRecord();
    return {
      serviceType: EDGE_DISCOVERY_SERVICE_TYPE,
      instanceName: `kitluy-hub-${record.hubDeviceId.slice(0, 8)}`,
      port: record.port,
      // A pointer, not a claim: the record id lets a terminal correlate the
      // hint with the signed record it MUST fetch and verify.
      txt: { rid: record.recordId, v: "1" }
    };
  }
};

// src/hub/edge/routes.ts
import { randomUUID as randomUUID8 } from "node:crypto";
init_dist();
init_db();

// src/hub/terminal-health.ts
import { randomUUID as randomUUID4 } from "node:crypto";
init_dist2();
init_db();
init_errors();
init_sync();
var TERMINAL_HEALTH_EVENT_NAME = "device_fleet.health_projection_reported";
var TERMINAL_HEALTH_SCHEMA_VERSION = 1;
var TERMINAL_HEALTH_AGGREGATE_TYPE = "device_fleet_health";
var HUB_ORIGINATED_EFFECT_ORDINALS2 = {
  [TERMINAL_HEALTH_EVENT_NAME]: 1
};
function healthReportEffectKey(healthReportId) {
  const ordinal = HUB_ORIGINATED_EFFECT_ORDINALS2[TERMINAL_HEALTH_EVENT_NAME];
  if (ordinal === void 0) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "health event has no registered ordinal", {});
  }
  const key = buildHubEffectKey(healthReportId, ordinal);
  if (!isValidHubEffectKey(key)) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "health effect key is not canonical kh1", {
      healthReportId
    });
  }
  return key;
}
var FORBIDDEN_PAYLOAD_KEY_FRAGMENTS2 = [
  "nonce",
  "privatekey",
  "proofsignature",
  "provisioningcode",
  "codedigest",
  "password",
  "secret",
  "connectionstring",
  "token"
];
var FORBIDDEN_PAYLOAD_VALUE2 = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|postgres(?:ql)?:\/\//;
function assertPublishableHealthPayload(payload) {
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_PAYLOAD_KEY_FRAGMENTS2.some((fragment) => normalized.includes(fragment))) {
      throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "health payload carries a forbidden key", {
        key
      });
    }
    if (typeof value === "string" && FORBIDDEN_PAYLOAD_VALUE2.test(value)) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        "health payload carries a forbidden value",
        {
          key
        }
      );
    }
  }
}
async function loadTerminalScope(client, terminalDeviceId) {
  const { rows } = await client.query(
    `select tenant_id, digital_store_id, location_id, assignment_generation,
            certificate_serial
       from edge_identity.terminal_device
      where id = $1`,
    [terminalDeviceId]
  );
  const row = rows[0];
  if (row === void 0) {
    throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "terminal is not registered", {
      terminalDeviceId
    });
  }
  return row;
}
async function hubReportingIdentity(client) {
  const { rows } = await client.query(
    `select hub_device_id, assignment_generation
       from edge_identity.hub_assignment
      where ended_at is null
      order by assignment_generation desc
      limit 1`
  );
  const row = rows[0];
  if (row === void 0) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "no live hub assignment", {});
  }
  return { hubDeviceId: row.hub_device_id, assignmentGeneration: row.assignment_generation };
}
async function effectiveContainment(client, terminalDeviceId) {
  const { rows } = await client.query(
    `select directive from edge_identity.effective_containment where device_uuid = $1`,
    [terminalDeviceId]
  );
  const directive = rows[0]?.directive;
  return directive === void 0 || directive === "cleared" ? "none" : directive;
}
async function credentialEligible(client, certificateSerial) {
  const { rows } = await client.query(
    `select exists (
        select 1 from edge_identity.device_credential
         where certificate_serial = $1
           and status = 'active' and revoked_at is null and expires_at > now()
      ) as eligible`,
    [certificateSerial]
  );
  return rows[0]?.eligible === true;
}
async function emitHealthReport(client, ctx) {
  const reportId = randomUUID4();
  const correlationId = randomUUID4();
  const seqRows = await client.query(
    `update edge_hardware.terminal_health_status
        set report_sequence = report_sequence + 1,
            last_reported_state = $2,
            last_projection_sent_at = now(),
            updated_at = now()
      where terminal_device_id = $1
      returning report_sequence`,
    [ctx.terminalDeviceId, ctx.derivedState]
  );
  const reportSequence = seqRows.rows[0]?.report_sequence;
  if (reportSequence === void 0) {
    throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "no health status row to report from", {
      terminalDeviceId: ctx.terminalDeviceId
    });
  }
  const containment = await effectiveContainment(client, ctx.terminalDeviceId);
  const eligible = await credentialEligible(client, ctx.scope.certificate_serial);
  const hub = await hubReportingIdentity(client);
  await client.query(
    `insert into edge_hardware.terminal_health_report
       (id, terminal_device_id, tenant_id, digital_store_id, location_id,
        report_sequence, derived_state, from_state, material, health_reasons,
        last_heartbeat_at, observed_at, software_version, release_version,
        configuration_version, containment_state, credential_eligible,
        correlation_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13,
             $14, $15, $16, $17, now())`,
    [
      reportId,
      ctx.terminalDeviceId,
      ctx.scope.tenant_id,
      ctx.scope.digital_store_id,
      ctx.scope.location_id,
      reportSequence.toString(),
      ctx.derivedState,
      ctx.fromState,
      ctx.material,
      [...ctx.reasons],
      ctx.lastHeartbeatAt,
      ctx.softwareVersion,
      ctx.releaseVersion,
      ctx.configurationVersion,
      containment,
      eligible,
      correlationId
    ]
  );
  const payload = {
    health_report_id: reportId,
    report_version: TERMINAL_HEALTH_SCHEMA_VERSION,
    terminal_device_id: ctx.terminalDeviceId,
    hub_device_id: hub.hubDeviceId,
    assignment_generation: ctx.scope.assignment_generation,
    tenant_id: ctx.scope.tenant_id,
    digital_store_id: ctx.scope.digital_store_id,
    location_id: ctx.scope.location_id,
    environment: ctx.environment,
    report_sequence: Number(reportSequence),
    observed_at: ctx.nowIso,
    last_local_contact_at: ctx.lastHeartbeatAt,
    health_classification: ctx.derivedState,
    health_reasons: [...ctx.reasons],
    software_version: ctx.softwareVersion,
    release_version: ctx.releaseVersion,
    configuration_version: ctx.configurationVersion,
    credential_eligible: eligible,
    containment_state: containment,
    correlation_id: correlationId
  };
  assertPublishableHealthPayload(payload);
  const idempotencyKey = healthReportEffectKey(reportId);
  const hubSequence = await allocateHubSequence(client);
  const envelope = {
    event_id: randomUUID4(),
    event_name: TERMINAL_HEALTH_EVENT_NAME,
    schema_version: TERMINAL_HEALTH_SCHEMA_VERSION,
    occurred_at: ctx.nowIso,
    recorded_at: (/* @__PURE__ */ new Date()).toISOString(),
    tenant_id: ctx.scope.tenant_id,
    digital_store_id: ctx.scope.digital_store_id,
    location_id: ctx.scope.location_id,
    aggregate: {
      type: TERMINAL_HEALTH_AGGREGATE_TYPE,
      id: ctx.terminalDeviceId,
      version: Number(reportSequence)
    },
    producer: SERVICE_NAME,
    source: {
      source_type: "store_hub",
      source_id: hub.hubDeviceId,
      device_id: ctx.terminalDeviceId,
      software_version: SERVICE_VERSION
    },
    actor: null,
    correlation_id: asId.correlationId(correlationId),
    causation_id: null,
    idempotency_key: asId.idempotencyKey(idempotencyKey),
    payload,
    payload_sha256: payloadChecksum(payload),
    replay: { is_replay: false }
  };
  assertValidEnvelope(envelope);
  await insertLocalEventWithOutbox(client, {
    id: envelope.event_id,
    tenantId: ctx.scope.tenant_id,
    digitalStoreId: ctx.scope.digital_store_id,
    locationId: ctx.scope.location_id,
    hubDeviceId: hub.hubDeviceId,
    originDeviceId: ctx.terminalDeviceId,
    actorId: null,
    aggregateType: TERMINAL_HEALTH_AGGREGATE_TYPE,
    aggregateId: ctx.terminalDeviceId,
    aggregateVersion: reportSequence,
    eventType: TERMINAL_HEALTH_EVENT_NAME,
    schemaVersion: TERMINAL_HEALTH_SCHEMA_VERSION,
    businessDate: ctx.nowIso.slice(0, 10),
    hubSequence,
    originSequence: 0n,
    assignmentGeneration: hub.assignmentGeneration,
    idempotencyKey,
    payloadSha256: envelope.payload_sha256,
    payload: envelope
  });
  return reportId;
}
async function acceptTerminalHeartbeat(pool, terminalDeviceId, body, environment, logger) {
  return withSerializableHubTransaction(
    pool,
    async (client) => {
      const scope = await loadTerminalScope(client, terminalDeviceId);
      const nowRows = await client.query(
        `select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now_iso`
      );
      const nowIso = nowRows.rows[0]?.now_iso ?? (/* @__PURE__ */ new Date()).toISOString();
      const statusRows = await client.query(
        `select derived_state, last_heartbeat_sequence, report_sequence,
                last_reported_state, heartbeat_count
           from edge_hardware.terminal_health_status
          where terminal_device_id = $1
          for update`,
        [terminalDeviceId]
      );
      let status = statusRows.rows[0];
      if (status === void 0) {
        await client.query(
          `insert into edge_hardware.terminal_health_status
             (terminal_device_id, tenant_id, digital_store_id, location_id,
              derived_state, health_reasons, last_heartbeat_at, heartbeat_count,
              software_version, derived_at, updated_at)
           values ($1, $2, $3, $4, 'unknown', '{}', null, 0, null, now(), now())
           on conflict (terminal_device_id) do nothing`,
          [terminalDeviceId, scope.tenant_id, scope.digital_store_id, scope.location_id]
        );
        const again = await client.query(
          `select derived_state, last_heartbeat_sequence, report_sequence,
                  last_reported_state, heartbeat_count
             from edge_hardware.terminal_health_status
            where terminal_device_id = $1
            for update`,
          [terminalDeviceId]
        );
        status = again.rows[0];
      }
      if (status === void 0) {
        throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "health status row unavailable", {
          terminalDeviceId
        });
      }
      const sequence = BigInt(body.heartbeatSequence);
      if (sequence === status.last_heartbeat_sequence) {
        return { result: "DUPLICATE_IGNORED", heartbeatSequence: body.heartbeatSequence };
      }
      if (sequence < status.last_heartbeat_sequence) {
        return {
          result: "HEARTBEAT_REPLAY_REJECTED",
          expectedAbove: Number(status.last_heartbeat_sequence)
        };
      }
      await client.query(
        `insert into edge_hardware.device_heartbeat
           (id, tenant_id, digital_store_id, location_id, device_id, device_kind,
            observed_at, application_version, config_snapshot_version,
            uptime_seconds, disk_free_bytes, lan_state, wan_state,
            last_hub_sequence, health_state, details_json)
         values ($1, $2, $3, $4, $5, 'terminal', now(), $6, $7, $8, $9,
                 'connected', 'unreported', null, $10, $11)`,
        [
          randomUUID4(),
          scope.tenant_id,
          scope.digital_store_id,
          scope.location_id,
          terminalDeviceId,
          body.applicationVersion,
          body.configSnapshotVersion,
          body.uptimeSeconds,
          body.diskFreeBytes ?? null,
          body.peripheralSummary ?? "unknown",
          JSON.stringify({
            queue_depth: body.queueDepth ?? null,
            local_database_available: body.localDatabaseAvailable ?? null,
            terminal_observed_at_diagnostic: body.observedAt ?? null,
            reason_codes: body.reasonCodes ?? []
          })
        ]
      );
      const fromState = status.derived_state;
      await client.query(
        `update edge_hardware.terminal_health_status
            set derived_state = 'healthy',
                health_reasons = '{}',
                last_heartbeat_at = now(),
                heartbeat_count = heartbeat_count + 1,
                last_heartbeat_sequence = $2,
                software_version = $3,
                derived_at = now(),
                updated_at = now()
          where terminal_device_id = $1`,
        [terminalDeviceId, sequence.toString(), body.applicationVersion]
      );
      const material = fromState !== "healthy";
      if (material) {
        await emitHealthReport(client, {
          terminalDeviceId,
          scope,
          derivedState: "healthy",
          fromState,
          material: true,
          reasons: [],
          lastHeartbeatAt: nowIso,
          nowIso,
          softwareVersion: body.applicationVersion,
          releaseVersion: body.releaseVersion ?? null,
          configurationVersion: String(body.configSnapshotVersion),
          environment
        });
      }
      logger?.info({
        event: "terminal_health.heartbeat_accepted",
        terminalDeviceId,
        heartbeatSequence: body.heartbeatSequence,
        material
      });
      return {
        result: "ACCEPTED",
        derivedState: "healthy",
        heartbeatSequence: body.heartbeatSequence,
        acceptedAt: nowIso,
        materialTransition: material
      };
    },
    HUB_RUNTIME_ROLE
  );
}

// src/hub/edge/routes.ts
init_runtime_bootstrap();
init_terminal_pin();

// src/hub/t1-intake.ts
import { createHash as createHash8, randomUUID as randomUUID7 } from "node:crypto";
init_dist2();
init_db();
init_sync();
init_runtime_bootstrap();
var CUSTOMER_CREATED_EVENT_NAME = "customer.local_customer_created";
var CONSENT_DECISION_EVENT_NAME = "customer.consent_decision_recorded";
var BOOKING_DRAFT_EVENT_NAME = "laundry.booking_draft_recorded";
var T1_INTAKE_SCHEMA_VERSION = 1;
var CONSENT_PURPOSE_KEYS = [
  "privacy_notice_acknowledgement",
  "operational_communication",
  "sms_marketing",
  "telegram_marketing",
  "email_marketing"
];
var DRAFT_CANCEL_REASONS = [
  "customer_left",
  "duplicate_intake",
  "entered_in_error",
  "customer_declined"
];
function sha256Hex3(value) {
  return createHash8("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}
function maskPhone(e164) {
  return `${e164.slice(0, 4)}\u2022\u2022\u2022\u2022${e164.slice(-4)}`;
}
var IntakeRefusalError = class extends Error {
  constructor(refusal2, detail) {
    super(detail);
    this.refusal = refusal2;
  }
};
function mapDoorError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("KLUY-EDGE-CUSTOMER-IDEMPOTENCY-CONFLICT")) {
    throw new IntakeRefusalError("CUSTOMER_IDEMPOTENCY_CONFLICT", "idempotency key reused");
  }
  if (message.includes("KLUY-EDGE-CONSENT-IDEMPOTENCY-CONFLICT")) {
    throw new IntakeRefusalError("CONSENT_IDEMPOTENCY_CONFLICT", "idempotency key reused");
  }
  if (message.includes("KLUY-EDGE-CONSENT-CUSTOMER-UNKNOWN")) {
    throw new IntakeRefusalError("CUSTOMER_UNKNOWN", "no such customer in this Store scope");
  }
  if (message.includes("KLUY-EDGE-CUSTOMER-REQUEST") || message.includes("violates check")) {
    throw new IntakeRefusalError("REQUEST_INVALID_SHAPE", "the request shape was refused");
  }
  throw error;
}
function toSummary(row) {
  return {
    customerId: row.id,
    displayName: row.display_name,
    phoneMasked: row.masked_value ?? (row.phone_e164 === null ? null : maskPhone(row.phone_e164)),
    phoneE164: row.phone_e164,
    phoneVerified: row.verified_at !== null,
    preferredLanguage: row.language_code,
    origin: row.origin,
    syncState: row.sync_state
  };
}
async function searchCustomersByPhone(pool, authority, phoneE164) {
  return withHubTransaction(
    pool,
    async (client) => {
      const hash = sha256Hex3(phoneE164);
      const rows = await client.query(
        `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                c.sync_state, i.masked_value, i.verified_at
           from edge_core.customer_identifier i
           join edge_core.customer c on c.id = i.customer_id
          where i.digital_store_id = $1::uuid and i.identifier_type = 'PHONE'
            and i.normalized_value_hash = $2
            and c.tenant_id = $3::uuid and c.deleted_at is null
          order by c.created_at asc`,
        [authority.digitalStoreId, hash, authority.tenantId]
      );
      return rows.rows.map(toSummary);
    },
    HUB_RUNTIME_ROLE
  );
}
async function readCustomer(pool, authority, customerId) {
  return withHubTransaction(
    pool,
    async (client) => {
      const rows = await client.query(
        `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                c.sync_state, i.masked_value, i.verified_at
           from edge_core.customer c
           left join edge_core.customer_identifier i
             on i.customer_id = c.id and i.identifier_type = 'PHONE'
          where c.id = $1::uuid and c.tenant_id = $2::uuid
            and c.digital_store_id = $3::uuid and c.deleted_at is null`,
        [customerId, authority.tenantId, authority.digitalStoreId]
      );
      const row = rows.rows[0];
      return row === void 0 ? null : toSummary(row);
    },
    HUB_RUNTIME_ROLE
  );
}
async function hubIdentity(client) {
  const { rows } = await client.query(
    `select hub_device_id, assignment_generation
       from edge_identity.hub_assignment
      where ended_at is null
      order by assignment_generation desc
      limit 1`
  );
  const row = rows[0];
  if (row === void 0)
    throw new IntakeRefusalError("REQUEST_INVALID_SHAPE", "no live hub assignment");
  return { hubDeviceId: row.hub_device_id, assignmentGeneration: row.assignment_generation };
}
async function emitIntakeFact(client, input) {
  const hub = await hubIdentity(client);
  const idempotencyKey = buildHubEffectKey(input.effectSourceId ?? input.aggregateId, 1);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const hubSequence = await allocateHubSequence(client);
  const envelope = {
    event_id: randomUUID7(),
    event_name: input.eventName,
    schema_version: T1_INTAKE_SCHEMA_VERSION,
    occurred_at: nowIso,
    recorded_at: nowIso,
    tenant_id: input.authority.tenantId,
    digital_store_id: input.authority.digitalStoreId,
    location_id: input.authority.locationId,
    aggregate: {
      type: input.aggregateType,
      id: input.aggregateId,
      version: input.aggregateVersion ?? 1
    },
    producer: SERVICE_NAME,
    source: {
      source_type: "store_hub",
      source_id: hub.hubDeviceId,
      device_id: input.terminalDeviceId,
      software_version: SERVICE_VERSION
    },
    actor: null,
    correlation_id: asId.correlationId(input.correlationId),
    causation_id: null,
    idempotency_key: asId.idempotencyKey(idempotencyKey),
    payload: input.payload,
    payload_sha256: payloadChecksum(input.payload),
    replay: { is_replay: false }
  };
  assertValidEnvelope(envelope);
  await insertLocalEventWithOutbox(client, {
    id: envelope.event_id,
    tenantId: input.authority.tenantId,
    digitalStoreId: input.authority.digitalStoreId,
    locationId: input.authority.locationId,
    hubDeviceId: hub.hubDeviceId,
    originDeviceId: input.terminalDeviceId,
    actorId: null,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: BigInt(input.aggregateVersion ?? 1),
    eventType: input.eventName,
    schemaVersion: T1_INTAKE_SCHEMA_VERSION,
    businessDate: nowIso.slice(0, 10),
    hubSequence,
    originSequence: 0n,
    assignmentGeneration: hub.assignmentGeneration,
    idempotencyKey,
    payloadSha256: envelope.payload_sha256,
    payload: envelope
  });
}
async function registerLocalCustomer(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const customerId = randomUUID7();
      const before = await client.query(
        `select id from edge_core.customer where created_request_key = $1`,
        [input.requestKey]
      );
      const replay = before.rows[0] !== void 0;
      let row;
      try {
        const result = await client.query(
          `select * from edge_core.register_local_customer_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9,
             't1_intake', $10, $11, $12::uuid)`,
          [
            customerId,
            input.authority.tenantId,
            input.authority.digitalStoreId,
            input.authority.locationId,
            input.displayName,
            input.phoneE164,
            input.phoneE164 === null ? null : sha256Hex3(input.phoneE164),
            input.phoneE164 === null ? null : maskPhone(input.phoneE164),
            input.preferredLanguage,
            input.requestKey,
            input.requestHash,
            input.correlationId
          ]
        );
        row = result.rows[0] ?? {};
      } catch (error) {
        mapDoorError(error);
      }
      const effectiveId = String(row.id ?? customerId);
      if (!replay) {
        await emitIntakeFact(client, {
          eventName: CUSTOMER_CREATED_EVENT_NAME,
          aggregateType: "customer",
          aggregateId: effectiveId,
          authority: input.authority,
          terminalDeviceId: input.terminalDeviceId,
          correlationId: input.correlationId,
          payload: {
            local_customer_id: effectiveId,
            tenant_id: input.authority.tenantId,
            digital_store_id: input.authority.digitalStoreId,
            display_name: input.displayName,
            phone_e164: input.phoneE164,
            phone_display: input.phoneRaw,
            preferred_locale: input.preferredLanguage,
            source_code: "t1_intake",
            correlation_id: input.correlationId
          }
        });
      }
      const summary = await client.query(
        `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                c.sync_state, i.masked_value, i.verified_at
           from edge_core.customer c
           left join edge_core.customer_identifier i
             on i.customer_id = c.id and i.identifier_type = 'PHONE'
          where c.id = $1::uuid`,
        [effectiveId]
      );
      const summaryRow = summary.rows[0];
      if (summaryRow === void 0) {
        throw new IntakeRefusalError("CUSTOMER_UNKNOWN", "registration produced no row");
      }
      return { customer: toSummary(summaryRow), created: !replay };
    },
    HUB_RUNTIME_ROLE
  );
}
async function recordConsentDecision(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const before = await client.query(
        `select id from edge_core.consent_decision where request_key = $1`,
        [input.requestKey]
      );
      const replay = before.rows[0] !== void 0;
      let row;
      try {
        const result = await client.query(
          `select * from edge_core.record_consent_decision_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::bigint,
             $9, $10, $11, $12::boolean, $13::uuid, $14::uuid, $15::uuid,
             $16, $17, $18::uuid)`,
          [
            randomUUID7(),
            input.authority.tenantId,
            input.authority.digitalStoreId,
            input.authority.locationId,
            input.customerId,
            input.purposeKey,
            input.policyRef,
            input.policyVersion,
            input.decision,
            input.channel,
            input.staffAssisted ? "staff_assisted" : "customer_self",
            input.staffAssisted,
            input.authority.actorId,
            input.terminalDeviceId,
            input.authority.sessionId,
            input.requestKey,
            input.requestHash,
            input.correlationId
          ]
        );
        row = result.rows[0] ?? {};
      } catch (error) {
        mapDoorError(error);
      }
      const decisionId = String(row.id ?? "");
      if (!replay) {
        await emitIntakeFact(client, {
          eventName: CONSENT_DECISION_EVENT_NAME,
          aggregateType: "consent_decision",
          aggregateId: decisionId,
          authority: input.authority,
          terminalDeviceId: input.terminalDeviceId,
          correlationId: input.correlationId,
          payload: {
            consent_decision_id: decisionId,
            local_customer_id: input.customerId,
            tenant_id: input.authority.tenantId,
            digital_store_id: input.authority.digitalStoreId,
            purpose_key: input.purposeKey,
            policy_ref: input.policyRef,
            policy_version: input.policyVersion,
            decision: input.decision,
            channel: input.channel,
            staff_assisted: input.staffAssisted,
            actor_id: input.authority.actorId,
            terminal_device_id: input.terminalDeviceId,
            correlation_id: input.correlationId
          }
        });
      }
      return {
        decisionId,
        recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
        created: !replay
      };
    },
    HUB_RUNTIME_ROLE
  );
}
function toDraftView(row) {
  return {
    draftId: row.id,
    lifecycle: row.lifecycle,
    version: Number(row.version),
    customerId: row.customer_id,
    walkIn: row.walk_in,
    customerSnapshot: row.customer_snapshot,
    preferredLanguage: row.preferred_language,
    intakeSource: row.intake_source,
    customerNotes: row.customer_notes,
    staffNotes: row.staff_notes,
    cancelReasonCode: row.cancel_reason_code,
    syncState: row.sync_state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
async function loadScopedDraft(client, authority, draftId) {
  const rows = await client.query(
    `select * from edge_laundry.booking_draft
      where id = $1::uuid and tenant_id = $2::uuid and digital_store_id = $3::uuid`,
    [draftId, authority.tenantId, authority.digitalStoreId]
  );
  return rows.rows[0] ?? null;
}
async function recordDraftEvent(client, input) {
  const receiptId = randomUUID7();
  await client.query(
    `insert into edge_laundry.booking_draft_event
       (id, draft_id, event_type, request_key, request_hash, changes,
        version_after, actor_id, terminal_device_id, session_id, correlation_id)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8::uuid, $9::uuid,
             $10::uuid, $11::uuid)`,
    [
      receiptId,
      input.draftId,
      input.eventType,
      input.requestKey,
      input.requestHash,
      JSON.stringify(input.changes),
      input.versionAfter,
      input.authority.actorId,
      input.terminalDeviceId,
      input.authority.sessionId,
      input.correlationId
    ]
  );
  await emitIntakeFact(client, {
    eventName: BOOKING_DRAFT_EVENT_NAME,
    aggregateType: "booking_draft",
    aggregateId: input.draftId,
    effectSourceId: receiptId,
    aggregateVersion: input.versionAfter,
    authority: input.authority,
    terminalDeviceId: input.terminalDeviceId,
    correlationId: input.correlationId,
    payload: {
      booking_draft_event_id: receiptId,
      hub_draft_id: input.draftId,
      event_type: input.eventType,
      tenant_id: input.authority.tenantId,
      digital_store_id: input.authority.digitalStoreId,
      location_id: input.authority.locationId,
      walk_in: input.draftState.walkIn,
      local_customer_id: input.draftState.customerId,
      customer_snapshot: input.draftState.customerSnapshot,
      lifecycle: input.draftState.lifecycle,
      version: input.draftState.version,
      preferred_language: input.draftState.preferredLanguage,
      intake_source: input.draftState.intakeSource,
      cancel_reason_code: input.draftState.cancelReasonCode,
      hub_created_at: input.draftState.createdAt,
      hub_updated_at: input.draftState.updatedAt,
      correlation_id: input.correlationId
    }
  });
}
async function replayedDraft(client, authority, requestKey, requestHash) {
  const prior = await client.query(
    `select draft_id, request_hash from edge_laundry.booking_draft_event where request_key = $1`,
    [requestKey]
  );
  const row = prior.rows[0];
  if (row === void 0) return null;
  if (row.request_hash !== requestHash) {
    throw new IntakeRefusalError("DRAFT_IDEMPOTENCY_CONFLICT", "idempotency key reused");
  }
  const draft = await loadScopedDraft(client, authority, row.draft_id);
  if (draft === null) throw new IntakeRefusalError("DRAFT_UNKNOWN", "no such draft");
  return toDraftView(draft);
}
async function createBookingDraft(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const replay = await replayedDraft(
        client,
        input.authority,
        input.requestKey,
        input.requestHash
      );
      if (replay !== null) return replay;
      let snapshot = { walkIn: true };
      if (!input.walkIn) {
        if (input.customerId === null) {
          throw new IntakeRefusalError(
            "REQUEST_INVALID_SHAPE",
            "a customer or walk-in is required"
          );
        }
        const rows = await client.query(
          `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                  c.sync_state, i.masked_value, i.verified_at
             from edge_core.customer c
             left join edge_core.customer_identifier i
               on i.customer_id = c.id and i.identifier_type = 'PHONE'
            where c.id = $1::uuid and c.tenant_id = $2::uuid
              and c.digital_store_id = $3::uuid and c.deleted_at is null`,
          [input.customerId, input.authority.tenantId, input.authority.digitalStoreId]
        );
        const customer = rows.rows[0];
        if (customer === void 0) {
          throw new IntakeRefusalError("CUSTOMER_UNKNOWN", "no such customer in this Store scope");
        }
        snapshot = {
          walkIn: false,
          customerId: customer.id,
          displayName: customer.display_name,
          phoneE164: customer.phone_e164,
          phoneMasked: customer.masked_value,
          phoneVerified: customer.verified_at !== null,
          preferredLanguage: customer.language_code,
          snapshotSyncState: customer.sync_state
        };
      }
      const draftId = randomUUID7();
      const inserted = await client.query(
        `insert into edge_laundry.booking_draft
           (id, tenant_id, digital_store_id, location_id, environment,
            terminal_device_id, session_id, staff_actor_id, customer_id, walk_in,
            customer_snapshot, preferred_language, intake_source,
            customer_notes, staff_notes, created_request_key,
            created_request_hash, correlation_id)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::uuid,
                 $8::uuid, $9::uuid, $10, $11::jsonb, $12, $13, $14, $15, $16,
                 $17, $18::uuid)
         returning *`,
        [
          draftId,
          input.authority.tenantId,
          input.authority.digitalStoreId,
          input.authority.locationId,
          input.environment,
          input.terminalDeviceId,
          input.authority.sessionId,
          input.authority.actorId,
          input.customerId,
          input.walkIn,
          JSON.stringify(snapshot),
          input.preferredLanguage,
          input.intakeSource,
          input.customerNotes,
          input.staffNotes,
          input.requestKey,
          input.requestHash,
          input.correlationId
        ]
      );
      const row = inserted.rows[0];
      if (row === void 0)
        throw new IntakeRefusalError("DRAFT_UNKNOWN", "insert returned nothing");
      await recordDraftEvent(client, {
        draftId,
        eventType: "created",
        draftState: toDraftView(row),
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        changes: { created: true },
        versionAfter: 1,
        authority: input.authority,
        terminalDeviceId: input.terminalDeviceId,
        correlationId: input.correlationId
      });
      return toDraftView(row);
    },
    HUB_RUNTIME_ROLE
  );
}
async function readBookingDraft(pool, authority, draftId) {
  return withHubTransaction(
    pool,
    async (client) => {
      const row = await loadScopedDraft(client, authority, draftId);
      return row === null ? null : toDraftView(row);
    },
    HUB_RUNTIME_ROLE
  );
}
async function updateBookingDraft(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const replay = await replayedDraft(
        client,
        input.authority,
        input.requestKey,
        input.requestHash
      );
      if (replay !== null) return replay;
      const row = await loadScopedDraft(client, input.authority, input.draftId);
      if (row === null) throw new IntakeRefusalError("DRAFT_UNKNOWN", "no such draft");
      if (row.lifecycle !== "open") {
        throw new IntakeRefusalError("DRAFT_NOT_OPEN", `the draft is ${row.lifecycle}`);
      }
      if (Number(row.version) !== input.expectedVersion) {
        throw new IntakeRefusalError(
          "DRAFT_VERSION_STALE",
          `expected version ${input.expectedVersion}, current ${Number(row.version)}`
        );
      }
      const changes = {};
      if (input.customerNotes !== void 0) changes["customerNotes"] = input.customerNotes;
      if (input.staffNotes !== void 0) changes["staffNotes"] = input.staffNotes;
      if (input.preferredLanguage !== void 0) {
        changes["preferredLanguage"] = input.preferredLanguage;
      }
      const nextVersion = Number(row.version) + 1;
      const updated = await client.query(
        `update edge_laundry.booking_draft
            set customer_notes = coalesce($3, customer_notes),
                staff_notes = coalesce($4, staff_notes),
                preferred_language = coalesce($5, preferred_language),
                version = $2
          where id = $1::uuid
          returning *`,
        [
          input.draftId,
          nextVersion,
          input.customerNotes ?? null,
          input.staffNotes ?? null,
          input.preferredLanguage ?? null
        ]
      );
      const next = updated.rows[0];
      if (next === void 0)
        throw new IntakeRefusalError("DRAFT_UNKNOWN", "update returned nothing");
      await recordDraftEvent(client, {
        draftId: input.draftId,
        eventType: "updated",
        draftState: toDraftView(next),
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        changes,
        versionAfter: nextVersion,
        authority: input.authority,
        terminalDeviceId: input.terminalDeviceId,
        correlationId: input.correlationId
      });
      return toDraftView(next);
    },
    HUB_RUNTIME_ROLE
  );
}
async function cancelBookingDraft(pool, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const replay = await replayedDraft(
        client,
        input.authority,
        input.requestKey,
        input.requestHash
      );
      if (replay !== null) return replay;
      const row = await loadScopedDraft(client, input.authority, input.draftId);
      if (row === null) throw new IntakeRefusalError("DRAFT_UNKNOWN", "no such draft");
      if (row.lifecycle !== "open") {
        throw new IntakeRefusalError("DRAFT_NOT_OPEN", `the draft is ${row.lifecycle}`);
      }
      const nextVersion = Number(row.version) + 1;
      const updated = await client.query(
        `update edge_laundry.booking_draft
            set lifecycle = 'cancelled', cancel_reason_code = $2, version = $3
          where id = $1::uuid
          returning *`,
        [input.draftId, input.reasonCode, nextVersion]
      );
      const next = updated.rows[0];
      if (next === void 0)
        throw new IntakeRefusalError("DRAFT_UNKNOWN", "cancel returned nothing");
      await recordDraftEvent(client, {
        draftId: input.draftId,
        eventType: "cancelled",
        draftState: toDraftView(next),
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        changes: { cancelReasonCode: input.reasonCode },
        versionAfter: nextVersion,
        authority: input.authority,
        terminalDeviceId: input.terminalDeviceId,
        correlationId: input.correlationId
      });
      return toDraftView(next);
    },
    HUB_RUNTIME_ROLE
  );
}

// ../../packages/localization/dist/index.js
var KH_E164 = /^\+855([1-9]\d{7,8})$/;
var KH_LOCAL = /^0([1-9]\d{7,8})$/;
function normalizeCambodianPhone(input) {
  const cleaned = input.replace(/[\s\-().]/g, "");
  let m = KH_E164.exec(cleaned);
  if (m)
    return { e164: `+855${m[1]}` };
  m = KH_E164.exec(`+${cleaned}`);
  if (m)
    return { e164: `+855${m[1]}` };
  m = KH_LOCAL.exec(cleaned);
  if (m)
    return { e164: `+855${m[1]}` };
  return null;
}

// src/hub/edge/routes.ts
init_errors();

// src/hub/commands/confirm-from-draft.ts
init_errors();

// src/hub/command-pipeline.ts
init_db();
init_errors();

// ../../packages/approvals/dist/index.js
var ApprovalError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ApprovalError";
  }
};
function assertFourEyes(request, decision) {
  if (request.requestedBy === decision.approvedBy) {
    throw new ApprovalError("SELF_APPROVAL_FORBIDDEN", "The requester cannot approve their own request (RB v4 \xA78.8).");
  }
  return decision;
}

// ../../packages/rbac/dist/index.js
init_dist2();

// ../../packages/resource-scope/dist/index.js
var HIERARCHICAL_SCOPE_LEVELS = [
  "platform",
  "region",
  "tenant",
  "chain",
  "digital_store",
  "store_location",
  "device_group",
  "device"
];
var NON_HIERARCHICAL_SCOPE_LEVELS = [
  "connector",
  "service",
  "release_cohort",
  "support_session",
  "file_object"
];
var SCOPE_LEVELS = [
  ...HIERARCHICAL_SCOPE_LEVELS,
  ...NON_HIERARCHICAL_SCOPE_LEVELS
];
var SCOPE_LEVEL_SET = new Set(SCOPE_LEVELS);
var HIERARCHICAL_SCOPE_LEVEL_SET = new Set(HIERARCHICAL_SCOPE_LEVELS);
function isScopeLevel(value) {
  return SCOPE_LEVEL_SET.has(value);
}
function sameScope(granted, requested) {
  if (!isScopeLevel(granted.level) || !isScopeLevel(requested.level)) {
    return false;
  }
  return granted.environment === requested.environment && granted.level === requested.level && granted.resourceId === requested.resourceId;
}

// ../../packages/rbac/dist/index.js
var ENVIRONMENT_SEGMENTS = new Set(KITLUY_ENVIRONMENTS);
var CANONICAL_PERMISSION_KEYS = [
  "identity.admin_profiles.read",
  "identity.admin_profiles.manage",
  "identity.sessions.revoke",
  "identity.mfa.policy_manage",
  "identity.break_glass.activate",
  "rbac.read",
  "rbac.team_manage",
  "rbac.role_manage",
  "rbac.permission_registry_manage",
  "rbac.assignment_manage",
  "rbac.owner_access_manage",
  "rbac.approval_policy_manage",
  "rbac.separation_of_duties_manage",
  "rbac.access_review",
  "rbac.effective_access.explain",
  "partners.read",
  "partners.verify",
  "partners.suspend",
  "partners.close",
  "digital_stores.read",
  "digital_stores.create",
  "digital_stores.vertical_lock",
  "digital_stores.activate",
  "digital_stores.suspend",
  "locations.read",
  "locations.create",
  "locations.go_live_request",
  "locations.go_live_approve",
  "locations.maintenance_toggle",
  "locations.decommission",
  "onboarding.readiness.evaluate",
  "onboarding.migration.validate",
  "onboarding.migration.execute",
  "onboarding.migration.rollback",
  "devices.read",
  "devices.register",
  "devices.assign",
  "devices.certificate.issue",
  "devices.certificate.rotate",
  "devices.revoke",
  "devices.identity_replace",
  "devices.remote_action.standard",
  "devices.remote_action.high_risk",
  // Amendment 001 (WS-11-T005-P02 owner package, 2026-08-06): governed device
  // containment. Owner identifiers recorded VERBATIM — singular `device.`
  // prefix noted in the amendment record, not harmonized silently.
  "device.containment.apply",
  "device.containment.clear",
  "fleet.diagnostics.read",
  "fleet.logs.request",
  "fleet.sync.trigger",
  "releases.read",
  "releases.artifact_register",
  "releases.rollout_create",
  "releases.promote_internal",
  "releases.promote_pilot",
  "releases.promote_stable",
  "releases.pause",
  "releases.rollback",
  "configuration.read",
  "configuration.publish",
  "configuration.rollback",
  "platform.health.read",
  "platform.jobs.retry",
  "platform.jobs.dead_letter_manage",
  "platform.incident.declare",
  "platform.safety_switch.toggle",
  "platform.backup.restore_test",
  "platform.backup.restore_production",
  "billing.read",
  "billing.invoice_adjust",
  "billing.invoice_mark_paid",
  "billing.grace_change",
  "billing.policy_manage",
  // Amendment 002 (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §4, WS-12-
  // T001-P02, 2026-08-06): Edge terminal staff sessions and the T1 shell
  // permission. Owner identifiers recorded VERBATIM. Opening or restoring a
  // session never authorizes T1 by itself — `pos.t1.use` is evaluated
  // separately (the six-dimension rule above).
  "staff.sessions.open",
  "staff.sessions.read",
  "staff.sessions.refresh",
  "staff.sessions.close",
  "pos.t1.use",
  // Amendment 003 (KLD-2026-08-06-WS12-T002-001 §2/§3, WS-12-T002,
  // 2026-08-06): T1 customer intake and consent. Owner identifiers recorded
  // VERBATIM. Booking-DRAFT permissions are deliberately NOT new keys —
  // draft read reuses `laundry.bookings.read`, draft mutations reuse
  // `laundry.bookings.create` (the recorded command-registry precedent).
  // No phone-verification key exists: no T1 path may mark a phone verified.
  "customers.read",
  "customers.create",
  "customers.consent.record",
  "support.ticket.manage",
  "support.evidence.read",
  "support.consent_session.start",
  "support.impersonation.start",
  "support.intervention.execute",
  "support.session.revoke",
  "integrations.read",
  "integrations.test",
  "integrations.credentials_rotate",
  "integrations.production_enable",
  "integrations.suspend",
  "webhooks.replay",
  "audit.read",
  "audit.export",
  "audit.security_review",
  "files.read",
  "files.security_export",
  "reports.export",
  "ai.policies.read",
  "ai.policies.manage",
  "ai.rag_sources.manage",
  "ai.mcp_tools.enable_read",
  "ai.mcp_tools.enable_write",
  // Vertical-namespaced registry rows — canonical key strings only (see the
  // neutral-Core boundary note above).
  "laundry.bookings.read",
  "laundry.bookings.create",
  "laundry.bookings.price_override",
  "laundry.ready_scan_in",
  "laundry.pickup_scan_out",
  "laundry.booking.complete",
  // End of vertical-namespaced rows.
  "payments.read",
  "payments.capture.cash",
  "payments.khqr.create",
  "payments.refund.request",
  "payments.refund.approve",
  "payments.void.request",
  "inventory.movements.read",
  "inventory.adjustment.request",
  "inventory.adjustment.approve"
];
var CANONICAL_PERMISSION_KEY_SET = new Set(CANONICAL_PERMISSION_KEYS);
function isCanonicalPermissionKey(key) {
  return CANONICAL_PERMISSION_KEY_SET.has(key);
}
function hasPermission(grants, permission, scope) {
  if (!isCanonicalPermissionKey(permission)) {
    return false;
  }
  return grants.some((g) => isCanonicalPermissionKey(g.permission) && g.permission === permission && sameScope(g.scope, scope));
}

// src/hub/authorization.ts
init_dist2();
init_errors();

// src/hub/revocation-trust.ts
init_dist();
init_db();
async function isDeviceRevokedOfflineWithin(client, hub, deviceRecordId) {
  const { rows } = await client.query(
    `select edge_config.is_device_revoked_offline_v1(
       $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid) as revoked`,
    [hub.tenantId, hub.digitalStoreId, hub.storeLocationId, hub.environment, deviceRecordId]
  );
  return rows[0]?.revoked === true;
}
async function isCertificateRevokedOfflineWithin(client, hub, serialNumber) {
  const { rows } = await client.query(
    `select edge_config.is_certificate_revoked_offline_v1(
       $1::uuid, $2::uuid, $3::uuid, $4, $5) as revoked`,
    [hub.tenantId, hub.digitalStoreId, hub.storeLocationId, hub.environment, serialNumber]
  );
  return rows[0]?.revoked === true;
}

// src/hub/authorization.ts
init_runtime_bootstrap();
var PERMISSION_TERMINAL_ROLES = {
  // "store_location, terminal_role:T1"
  "laundry.bookings.create": ["laundry.t1.intake_cashier"],
  "laundry.bookings.price_override": ["laundry.t1.intake_cashier"],
  // "store_location, terminal_role:T3"
  "laundry.ready_scan_in": ["laundry.t3.ready_scan_in"],
  // "store_location, terminal_role:T4"
  "laundry.pickup_scan_out": ["laundry.t4.pickup_scan_out"],
  "laundry.booking.complete": ["laundry.t4.pickup_scan_out"],
  // "store_location, terminal_role:T1|T4"
  "payments.capture.cash": ["laundry.t1.intake_cashier", "laundry.t4.pickup_scan_out"],
  // "store_location, terminal_role:T1|T4, storefront"
  "payments.khqr.create": ["laundry.t1.intake_cashier", "laundry.t4.pickup_scan_out"],
  // "tenant, digital_store, store_location, payment" — NO terminal_role.
  "payments.refund.request": null,
  // "store_location, transaction" — NO terminal_role.
  "payments.void.request": null
};
var HUB_ALLOWED_ENVIRONMENTS = ["local", "development"];
function deny(code, message, details = {}) {
  throw new HubCommandError(code, message, details);
}
async function authorizeHubCommand(client, definition, device, options = {}) {
  for (const [field, value] of Object.entries({
    terminalDeviceId: device.terminalDeviceId,
    sessionId: device.sessionId,
    actorId: device.actorId,
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId
  })) {
    if (typeof value !== "string" || !isUuid(value)) {
      deny("EDGE_DEVICE_CONTEXT_INVALID", `device context field '${field}' is not a UUID.`, {
        field
      });
    }
  }
  if (!Number.isInteger(device.assignmentGeneration) || device.assignmentGeneration < 1) {
    deny(
      "EDGE_DEVICE_CONTEXT_INVALID",
      "assignment_generation must be an integer >= 1 (offline contract \xA75.1)."
    );
  }
  if (!isLaundryTerminalProfile(device.profileCode)) {
    deny(
      "EDGE_DEVICE_CONTEXT_INVALID",
      `'${device.profileCode}' is not a canonical logical terminal profile.`,
      { profileCode: device.profileCode }
    );
  }
  const profile = device.profileCode;
  const assignment = await identity_exports.findActiveHubAssignment(client);
  if (!assignment || assignment.status !== "active") {
    deny("EDGE_DEVICE_NOT_ASSIGNED", "this Hub has no ACTIVE Location assignment.");
  }
  const terminal = await identity_exports.findTerminalDevice(client, device.terminalDeviceId);
  if (!terminal) {
    deny("EDGE_TERMINAL_UNKNOWN", `terminal device ${device.terminalDeviceId} is not registered.`, {
      terminalDeviceId: device.terminalDeviceId
    });
  }
  if (terminal.lifecycle_status !== "active") {
    deny(
      "EDGE_DEVICE_REVOKED",
      `terminal device ${terminal.id} lifecycle_status is '${terminal.lifecycle_status}'.`,
      { terminalDeviceId: terminal.id, lifecycleStatus: terminal.lifecycle_status }
    );
  }
  const credentials = await identity_exports.findDeviceCredentials(client, terminal.id);
  const revoked = credentials.find((c) => c.status === "revoked");
  if (revoked) {
    deny("EDGE_DEVICE_REVOKED", `terminal device ${terminal.id} holds a REVOKED credential.`, {
      terminalDeviceId: terminal.id,
      revocationReason: revoked.revocation_reason
    });
  }
  const hubScope = {
    tenantId: assignment.tenant_id,
    digitalStoreId: assignment.digital_store_id,
    storeLocationId: assignment.location_id,
    environment: device.environment,
    hubDeviceId: assignment.hub_device_id
  };
  for (const deviceRecordId of [assignment.hub_device_id, terminal.id]) {
    if (await isDeviceRevokedOfflineWithin(client, hubScope, deviceRecordId)) {
      deny(
        "EDGE_DEVICE_REVOKED",
        `device record ${deviceRecordId} is revoked by the Hub's held revocation snapshot.`,
        {
          terminalDeviceId: terminal.id,
          deviceRecordId,
          source: "OFFLINE_REVOCATION_SNAPSHOT"
        }
      );
    }
  }
  for (const credential of credentials) {
    const offlineRevoked = await isCertificateRevokedOfflineWithin(
      client,
      hubScope,
      credential.certificate_serial
    );
    if (offlineRevoked) {
      deny(
        "EDGE_DEVICE_REVOKED",
        `certificate ${credential.certificate_serial} is revoked by the Hub's held revocation snapshot.`,
        {
          terminalDeviceId: terminal.id,
          certificateSerial: credential.certificate_serial,
          // Named so an operator can tell this apart from the replicated-status
          // denial above: this one fired with no cloud involved.
          source: "OFFLINE_REVOCATION_SNAPSHOT"
        }
      );
    }
  }
  if (device.assignmentGeneration !== terminal.assignment_generation) {
    deny(
      "EDGE_ASSIGNMENT_GENERATION_MISMATCH",
      `assignment_generation ${device.assignmentGeneration} does not match the terminal's projected generation ${terminal.assignment_generation}.`,
      {
        presented: device.assignmentGeneration,
        deviceGeneration: terminal.assignment_generation,
        hubGeneration: assignment.assignment_generation
      }
    );
  }
  const session = await identity_exports.findTerminalSession(client, device.sessionId);
  if (!session) {
    deny("EDGE_SESSION_INVALID", `session ${device.sessionId} does not exist.`);
  }
  if (session.closed_at !== null || session.status !== "open") {
    deny("EDGE_SESSION_INVALID", `session ${session.id} is not open.`, { status: session.status });
  }
  if (session.terminal_device_id !== terminal.id) {
    deny("EDGE_SESSION_INVALID", `session ${session.id} belongs to a different terminal.`);
  }
  if (session.actor_id !== device.actorId) {
    deny("EDGE_SESSION_INVALID", `session ${session.id} is bound to a different actor.`);
  }
  const pinSession = session.credential_kind === "terminal_pin";
  if (pinSession && (session.actor_id !== terminal.id || device.actorId !== terminal.id)) {
    deny(
      "EDGE_SESSION_INVALID",
      `Terminal PIN session ${session.id} must name its terminal as actor.`
    );
  }
  const now = await currentDatabaseTime(client);
  if (session.expires_at.getTime() <= now.getTime()) {
    deny(
      "EDGE_SESSION_EXPIRED",
      `session ${session.id} expired at ${session.expires_at.toISOString()}.`,
      {
        expiresAt: session.expires_at.toISOString()
      }
    );
  }
  if (session.profile_code !== profile) {
    deny(
      "EDGE_PROFILE_NOT_AUTHORIZED",
      `session ${session.id} is open on profile '${session.profile_code}', not '${profile}'.`,
      { sessionProfile: session.profile_code, requestedProfile: profile }
    );
  }
  const profileAssignment = await config_exports.findActiveProfileAssignment(
    client,
    terminal.id,
    profile
  );
  if (!profileAssignment) {
    deny(
      "EDGE_PROFILE_NOT_AUTHORIZED",
      `terminal ${terminal.id} holds no ACTIVE cloud grant for profile '${profile}'.`,
      { terminalDeviceId: terminal.id, profileCode: profile }
    );
  }
  if (!definition.allowedProfiles.includes(profile)) {
    deny(
      "EDGE_PROFILE_NOT_AUTHORIZED",
      `command '${definition.commandType}' does not allow profile '${profile}'.`,
      { commandType: definition.commandType, profileCode: profile }
    );
  }
  const scope = {
    level: "store_location",
    resourceId: device.locationId,
    environment: device.environment
  };
  const required = [definition.permission, ...options.requiredConditionalPermissions ?? []];
  for (const permission of required) {
    if (!isCanonicalPermissionKey(permission)) {
      deny(
        "EDGE_PERMISSION_KEY_UNREGISTERED",
        `permission '${permission}' is not in the canonical RBAC registry; unknown keys fail closed.`,
        { permission }
      );
    }
  }
  let source = "profile_derived";
  let actorType = "staff";
  let actorDisplayName = "";
  let staff = void 0;
  if (pinSession) {
    if (await readBlockingContainment(client, terminal.id) !== null) {
      deny(
        "EDGE_DEVICE_REVOKED",
        `terminal ${terminal.id} is under a blocking containment directive.`,
        {
          terminalDeviceId: terminal.id,
          source: "CONTAINMENT_DIRECTIVE"
        }
      );
    }
    for (const permission of required) {
      if (!T1_TERMINAL_PIN_PERMISSIONS.includes(permission)) {
        deny(
          "EDGE_PERMISSION_DENIED",
          `'${permission}' is not part of the T1 terminal surface a Terminal PIN session may exercise.`,
          { actorId: device.actorId, permission, credentialKind: "terminal_pin" }
        );
      }
    }
    source = "terminal_pin";
    actorType = "terminal_device";
    actorDisplayName = terminal.terminal_name;
  } else {
    staff = await identity_exports.findStaffCache(client, device.actorId);
    if (!staff) {
      deny(
        "EDGE_PERMISSION_DENIED",
        `actor ${device.actorId} has no cached permission projection.`,
        {
          actorId: device.actorId
        }
      );
    }
    if (staff.disabled) {
      deny("EDGE_PERMISSION_DENIED", `actor ${device.actorId} is disabled.`, {
        actorId: device.actorId
      });
    }
    if (staff.offline_valid_until.getTime() <= now.getTime()) {
      deny(
        "EDGE_PERMISSION_DENIED",
        `actor ${device.actorId} permission projection expired at ${staff.offline_valid_until.toISOString()}.`,
        { actorId: device.actorId }
      );
    }
    for (const permission of required) {
      const outcome = evaluatePermission(permission, staff.profile_codes, device, scope);
      if (outcome === "denied") {
        deny("EDGE_PERMISSION_DENIED", `actor ${device.actorId} does not hold '${permission}'.`, {
          actorId: device.actorId,
          permission,
          heldProfiles: staff.profile_codes
        });
      }
      if (outcome === "session_presented") source = "session_presented";
    }
    actorDisplayName = staff.display_name;
  }
  const scopeTuple = {
    tenant: device.tenantId,
    store: device.digitalStoreId,
    location: device.locationId
  };
  const mismatches = [];
  if (assignment.tenant_id !== scopeTuple.tenant) mismatches.push("hub_assignment.tenant_id");
  if (assignment.digital_store_id !== scopeTuple.store)
    mismatches.push("hub_assignment.digital_store_id");
  if (assignment.location_id !== scopeTuple.location) mismatches.push("hub_assignment.location_id");
  if (terminal.tenant_id !== scopeTuple.tenant) mismatches.push("terminal_device.tenant_id");
  if (terminal.digital_store_id !== scopeTuple.store)
    mismatches.push("terminal_device.digital_store_id");
  if (terminal.location_id !== scopeTuple.location) mismatches.push("terminal_device.location_id");
  if (session.tenant_id !== scopeTuple.tenant) mismatches.push("terminal_session.tenant_id");
  if (session.location_id !== scopeTuple.location) mismatches.push("terminal_session.location_id");
  if (staff !== void 0) {
    if (staff.tenant_id !== scopeTuple.tenant) mismatches.push("staff_cache.tenant_id");
    if (staff.location_id !== scopeTuple.location) mismatches.push("staff_cache.location_id");
  }
  if (options.targetScope) {
    if (options.targetScope.tenantId !== scopeTuple.tenant) mismatches.push("target.tenant_id");
    if (options.targetScope.digitalStoreId !== scopeTuple.store)
      mismatches.push("target.digital_store_id");
    if (options.targetScope.locationId !== scopeTuple.location)
      mismatches.push("target.location_id");
  }
  if (mismatches.length > 0) {
    deny("EDGE_RESOURCE_SCOPE_DENIED", `scope mismatch on ${mismatches.join(", ")}.`, {
      mismatches,
      ...scopeTuple
    });
  }
  if (!KITLUY_ENVIRONMENTS.includes(device.environment)) {
    deny("EDGE_ENVIRONMENT_DENIED", `'${device.environment}' is not a canonical environment.`);
  }
  if (!HUB_ALLOWED_ENVIRONMENTS.includes(device.environment)) {
    deny(
      "EDGE_ENVIRONMENT_DENIED",
      `the Hub command layer refuses environment '${device.environment}' (KL-INF-P1-037: development targets only).`,
      { environment: device.environment }
    );
  }
  if (definition.approvalRequired) {
    if (!options.approval) {
      deny(
        "EDGE_APPROVAL_REQUIRED",
        `command '${definition.commandType}' requires recorded four-eyes approval evidence.`,
        { commandType: definition.commandType, riskClass: definition.riskClass }
      );
    }
    try {
      assertFourEyes(options.approval.request, options.approval.decision);
    } catch (error) {
      deny(
        "EDGE_SELF_APPROVAL_FORBIDDEN",
        error instanceof Error ? error.message : "self-approval is forbidden.",
        { commandType: definition.commandType }
      );
    }
    if (options.approval.decision.decision !== "approved") {
      deny("EDGE_APPROVAL_REQUIRED", "the presented approval decision is not 'approved'.");
    }
  }
  return {
    device,
    profile,
    hubDeviceId: assignment.hub_device_id,
    // The ordering namespace of everything this Hub emits (offline §5.1).
    assignmentGeneration: assignment.assignment_generation,
    actorDisplayName,
    permission: definition.permission,
    permissionSource: source,
    actorType,
    scope,
    ...options.approval ? { approval: options.approval } : {}
  };
}
function evaluatePermission(permission, heldProfiles, device, scope) {
  const terminalRoles = PERMISSION_TERMINAL_ROLES[permission];
  if (terminalRoles !== void 0 && terminalRoles !== null) {
    return terminalRoles.some((role) => heldProfiles.includes(role)) ? "profile_derived" : "denied";
  }
  const presented = device.presentedGrants ?? [];
  return hasPermission([...presented], permission, scope) ? "session_presented" : "denied";
}
async function currentDatabaseTime(client) {
  const result = await client.query("select now() as now");
  const value = result.rows[0]?.now;
  return value ?? /* @__PURE__ */ new Date();
}

// ../../packages/edge-contracts/dist/permissions.js
var PERMISSION_REQUIRED_MARKER_PREFIX = "[REQUIRED:";
function isRequiredPermissionMarker(value) {
  return value.startsWith(PERMISSION_REQUIRED_MARKER_PREFIX) && value.endsWith("]");
}
var PERMISSION_GAP_EDGE_DISPLAY_MANAGE = "[REQUIRED: RBAC permission key for opening, updating and closing a T2 customer-display session from T1 \u2014 absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv]";
var PERMISSION_GAP_EDGE_DISPLAY_READ = "[REQUIRED: RBAC permission key for an assigned T2 device to read its own customer-safe display state \u2014 absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv]";
var PERMISSION_GAP_EDGE_DISPLAY_CUSTOMER_ACTION = "[REQUIRED: RBAC permission key for recording a customer-originated T2 action (language, receipt choice, confirmation) as consent evidence \u2014 absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv]";

// ../../packages/edge-contracts/dist/route-paths.js
var EDGE_ROUTE_SESSIONS_OPEN = "/edge/v1/sessions/open";
var EDGE_ROUTE_SESSIONS_REFRESH = "/edge/v1/sessions/refresh";
var EDGE_ROUTE_SESSIONS_SWITCH = "/edge/v1/sessions/switch";
var EDGE_ROUTE_SESSIONS_CLOSE = "/edge/v1/sessions/close";
var EDGE_ROUTE_DISPLAY_SESSIONS = "/edge/v1/display-sessions";
var EDGE_ROUTE_DISPLAY_SESSION = "/edge/v1/display-sessions/{id}";
var EDGE_ROUTE_DISPLAY_SESSION_CUSTOMER_ACTIONS = "/edge/v1/display-sessions/{id}/customer-actions";
var EDGE_ROUTE_DISPLAY_SESSION_CLOSE = "/edge/v1/display-sessions/{id}/close";
var EDGE_ROUTE_LAUNDRY_BOOKING_DRAFTS = "/edge/v1/laundry/bookings/drafts";
var EDGE_ROUTE_LAUNDRY_BOOKING_CONFIRM_INTAKE = "/edge/v1/laundry/bookings/{id}/confirm-intake";
var EDGE_ROUTE_LAUNDRY_READY_SESSIONS = "/edge/v1/laundry/ready-sessions";
var EDGE_ROUTE_LAUNDRY_READY_SESSION_SCANS = "/edge/v1/laundry/ready-sessions/{id}/scans";
var EDGE_ROUTE_LAUNDRY_READY_SESSION_QA = "/edge/v1/laundry/ready-sessions/{id}/qa";
var EDGE_ROUTE_LAUNDRY_READY_SESSION_EXCEPTIONS = "/edge/v1/laundry/ready-sessions/{id}/exceptions";
var EDGE_ROUTE_LAUNDRY_READY_SESSION_STORAGE = "/edge/v1/laundry/ready-sessions/{id}/storage";
var EDGE_ROUTE_LAUNDRY_READY_SESSION_COMPLETE = "/edge/v1/laundry/ready-sessions/{id}/complete";
var EDGE_ROUTE_LAUNDRY_PICKUP_SESSIONS = "/edge/v1/laundry/pickup-sessions";
var EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COLLECTOR_VERIFICATION = "/edge/v1/laundry/pickup-sessions/{id}/collector-verification";
var EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_SCANS = "/edge/v1/laundry/pickup-sessions/{id}/scans";
var EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_PAYMENTS = "/edge/v1/laundry/pickup-sessions/{id}/payments";
var EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COMPLETE = "/edge/v1/laundry/pickup-sessions/{id}/complete";

// ../../packages/edge-contracts/dist/terminal-profiles.js
var TERMINAL_PROFILE_T1_INTAKE_CASHIER = "laundry.t1.intake_cashier";
var TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY = "laundry.t2.customer_display";
var TERMINAL_PROFILE_T3_READY_SCAN_IN = "laundry.t3.ready_scan_in";
var TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT = "laundry.t4.pickup_scan_out";

// ../../packages/edge-contracts/dist/generic-routes.js
var GROUP_1 = "KLD-2026-07-26-002 Group 1 (APPROVED)";
var SESSION_ROUTES = [
  {
    id: "sessions-open",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_OPEN,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.open",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: "staff.sessions.open",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "sessions-refresh",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_REFRESH,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.refresh",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: "staff.sessions.refresh",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.refreshed",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "sessions-switch",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_SWITCH,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.switch",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    // Recorded interpretation (Amendment 002 §2): a switch closes the
    // incumbent actor's session and opens the successor's.
    permission: "staff.sessions.open",
    permissionStatus: "registered",
    conditionalPermissions: ["staff.sessions.close"],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.actor_switched",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "sessions-close",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_CLOSE,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.close",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: "staff.sessions.close",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.closed",
    auditEventStatus: "proposed",
    authority: GROUP_1
  }
];
var DISPLAY_SESSION_ROUTES = [
  {
    id: "display-sessions-open",
    method: "POST",
    path: EDGE_ROUTE_DISPLAY_SESSIONS,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.open",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "display_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "display-sessions-update",
    method: "PATCH",
    path: EDGE_ROUTE_DISPLAY_SESSION,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.update",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "display_session.updated",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "display-sessions-read",
    method: "GET",
    path: EDGE_ROUTE_DISPLAY_SESSION,
    family: "generic",
    kind: "read",
    scope: "edge.display.read",
    scopeStatus: "registered",
    riskClass: "A0_READ",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_READ,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY],
    idempotencyRequired: false,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "display_session.read",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "display-sessions-customer-actions",
    method: "POST",
    path: EDGE_ROUTE_DISPLAY_SESSION_CUSTOMER_ACTIONS,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.customer_action",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_CUSTOMER_ACTION,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "display_session.customer_action_recorded",
    auditEventStatus: "proposed",
    authority: GROUP_1
  },
  {
    id: "display-sessions-close",
    method: "POST",
    path: EDGE_ROUTE_DISPLAY_SESSION_CLOSE,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.close",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "display_session.closed",
    auditEventStatus: "proposed",
    authority: GROUP_1
  }
];
var GENERIC_EDGE_ROUTES = [
  ...SESSION_ROUTES,
  ...DISPLAY_SESSION_ROUTES
];

// ../../packages/edge-contracts/dist/laundry-routes.js
var GROUP_12 = "KLD-2026-07-26-002 Group 1 (APPROVED)";
var T1_BOOKING_ROUTES = [
  {
    id: "laundry-booking-draft-create",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_BOOKING_DRAFTS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.bookings.create",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.bookings.create",
    permissionStatus: "registered",
    conditionalPermissions: ["laundry.bookings.price_override"],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "laundry_booking.draft_created",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-booking-confirm-intake",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_BOOKING_CONFIRM_INTAKE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.bookings.finalize",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.bookings.create",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.created",
    auditEventStatus: "registered",
    authority: GROUP_12
  }
];
var T3_READY_ROUTES = [
  {
    id: "laundry-ready-session-open",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSIONS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.open",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-ready-session-scan",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_SCANS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.scan",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "garment.custody_scanned_in",
    auditEventStatus: "registered",
    authority: GROUP_12
  },
  {
    id: "laundry-ready-session-qa",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_QA,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.qa",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.qa_recorded",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-ready-session-exception",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_EXCEPTIONS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.exception",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.exception_recorded",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-ready-session-storage",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_STORAGE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.storage",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.storage_assigned",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-ready-session-complete",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_COMPLETE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.complete",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.ready",
    auditEventStatus: "registered",
    authority: GROUP_12
  }
];
var T4_PICKUP_ROUTES = [
  {
    id: "laundry-pickup-session-open",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSIONS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.open",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.pickup_scan_out",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "laundry_pickup_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-pickup-session-verify-collector",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COLLECTOR_VERIFICATION,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.verify_collector",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.pickup_scan_out",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_pickup_session.collector_verified",
    auditEventStatus: "proposed",
    authority: GROUP_12
  },
  {
    id: "laundry-pickup-session-scan",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_SCANS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.scan",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.pickup_scan_out",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "garment.custody_scanned_out",
    auditEventStatus: "registered",
    authority: GROUP_12
  },
  {
    id: "laundry-pickup-session-payment",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_PAYMENTS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.payment",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "payments.capture.cash",
    permissionStatus: "registered",
    conditionalPermissions: ["payments.khqr.create"],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "payment.recorded",
    auditEventStatus: "registered",
    authority: GROUP_12
  },
  {
    id: "laundry-pickup-session-complete",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COMPLETE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.release",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.booking.complete",
    permissionStatus: "registered",
    conditionalPermissions: ["laundry.pickup_scan_out"],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.completed",
    auditEventStatus: "proposed",
    authority: GROUP_12
  }
];
var LAUNDRY_EDGE_ROUTES = [
  ...T1_BOOKING_ROUTES,
  ...T3_READY_ROUTES,
  ...T4_PICKUP_ROUTES
];

// ../../packages/edge-contracts/dist/registry.js
var EDGE_ROUTES = [
  ...GENERIC_EDGE_ROUTES,
  ...LAUNDRY_EDGE_ROUTES
];
function findEdgeRouteById(id) {
  return EDGE_ROUTES.find((route) => route.id === id);
}

// ../../packages/edge-contracts/dist/scopes.js
var REGISTERED_EDGE_SCOPES = [
  "edge.bookings.create",
  "edge.bookings.update_draft",
  "edge.bookings.finalize",
  "edge.payments.record",
  "edge.display.open",
  "edge.display.read",
  "edge.display.update",
  "edge.display.close",
  "edge.ready.open",
  "edge.ready.scan",
  "edge.ready.qa",
  "edge.ready.storage",
  "edge.ready.complete",
  "edge.pickup.open",
  "edge.pickup.verify_collector",
  "edge.pickup.scan",
  "edge.pickup.payment",
  "edge.pickup.release",
  "edge.sync.read",
  "edge.sync.push",
  "edge.sync.pull"
];
var ADDITIVE_EDGE_SCOPES = [
  /** Open a Hub-issued terminal session. Named in Edge Ops API §9.1 (`/sessions/login`), absent from registry §5. */
  "edge.session.open",
  /** Rotate a short-lived Hub session token (Store Hub LAN API §`POST /sessions/refresh`). New key. */
  "edge.session.refresh",
  /** Switch the staff actor bound to an open session. Named in Edge Ops API §9.1, absent from registry §5. */
  "edge.session.switch",
  /** Close a session and clear profile state (Store Hub LAN API §`POST /sessions/close`). New key. */
  "edge.session.close",
  /** Record a customer-originated T2 action (language, receipt choice, confirmation). */
  "edge.display.customer_action",
  /** Record a Ready-session exception. Edge Ops API §9.4 has no exception scope. */
  "edge.ready.exception",
  // KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001: the three T1 bootstrap reads.
  /** Read Hub-database authority time (§1 of the bootstrap decision). */
  "edge.runtime.time_read",
  /** Read this terminal's derived runtime eligibility (§2). */
  "edge.runtime.eligibility_read",
  /** Read the current signed configuration delivery for this terminal (§3). */
  "edge.configuration.read",
  // KLD-2026-08-06-WS12-T002-001: T1 customer intake. `edge.customers.search`
  // and `edge.customers.create` are NAMED by Edge Ops API §9.2 and absent
  // from registry §5; the read and consent scopes are new keys.
  /** Scoped exact-match customer search (§2 of the T002 decision). */
  "edge.customers.search",
  /** Read one scoped customer record. */
  "edge.customers.read",
  /** Create a minimal unverified customer at T1 (§2.6). */
  "edge.customers.create",
  /** Record an explicit consent decision with immutable evidence (§3). */
  "edge.customers.consent_record"
];
var EDGE_API_SCOPES = [...REGISTERED_EDGE_SCOPES, ...ADDITIVE_EDGE_SCOPES];

// src/hub/command-registry.ts
init_errors();
var T1 = "laundry.t1.intake_cashier";
var T4 = "laundry.t4.pickup_scan_out";
function requireRoute(routeId) {
  const route = findEdgeRouteById(routeId);
  if (!route) {
    throw new Error(`Edge route '${routeId}' is not in the canonical registry.`);
  }
  return route;
}
function fromRoute(commandType, routeId, aggregateType) {
  const route = requireRoute(routeId);
  const unregistered = isRequiredPermissionMarker(route.permission);
  return {
    commandType,
    aggregateType,
    routeId,
    routeTemplate: route.path,
    method: route.method === "PATCH" ? "PATCH" : "POST",
    riskClass: route.riskClass,
    permission: route.permission,
    conditionalPermissions: route.conditionalPermissions,
    allowedProfiles: route.allowedTerminalProfiles,
    expectedVersionRequired: route.expectedVersionRequired,
    approvalRequired: route.approvalRequired,
    auditEvent: route.auditEvent,
    active: !unregistered,
    ...unregistered ? {
      inactiveReason: `KLREQ-015: the approved route ${routeId} carries no canonical permission key \u2014 ${route.permission}`
    } : {}
  };
}
function hubInternal(commandType, aggregateType, input) {
  const unregistered = isRequiredPermissionMarker(input.permission);
  const active = (input.active ?? true) && !unregistered;
  return {
    commandType,
    aggregateType,
    routeId: null,
    routeTemplate: input.routeTemplate,
    method: "POST",
    riskClass: input.riskClass,
    permission: input.permission,
    conditionalPermissions: input.conditionalPermissions ?? [],
    allowedProfiles: input.allowedProfiles,
    expectedVersionRequired: input.expectedVersionRequired,
    approvalRequired: input.approvalRequired,
    auditEvent: input.auditEvent,
    active,
    ...active ? {} : {
      inactiveReason: input.inactiveReason ?? `KLREQ-015: no canonical permission key \u2014 ${input.permission}`
    }
  };
}
var PERMISSION_GAP_HUB_PROVIDER_CALLBACK = "[REQUIRED: RBAC permission key for applying an authoritative payment-provider callback on the Store Hub \u2014 absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv; the Hub applies it as a service, not as an actor]";
var DEFINITIONS = [
  // ---------------------------------------------------------------- Booking
  fromRoute("laundry.booking.create_draft", "laundry-booking-draft-create", "booking"),
  hubInternal("laundry.booking.update_draft", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}",
    permission: "laundry.bookings.create",
    conditionalPermissions: ["laundry.bookings.price_override"],
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.draft_updated"
  }),
  hubInternal("laundry.booking.add_line", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/lines",
    permission: "laundry.bookings.create",
    conditionalPermissions: ["laundry.bookings.price_override"],
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.draft_line_added"
  }),
  hubInternal("laundry.booking.register_garment", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/garments",
    permission: "laundry.bookings.create",
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.garment_registered"
  }),
  hubInternal("laundry.booking.assign_tag", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/tags",
    permission: "laundry.bookings.create",
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.tag_assigned"
  }),
  hubInternal("laundry.booking.assign_container", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/containers",
    permission: "laundry.bookings.create",
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.container_assigned"
  }),
  fromRoute("laundry.booking.confirm_intake", "laundry-booking-confirm-intake", "booking"),
  // T1-REAL-OPERATIONS-001 slice 2 (KLD-2026-09-19-T1-REAL-OPERATIONS-001
  // decision 1): the SAME approved route, served with `{id}` = the WS-12-T002
  // Booking Draft. One command converts the draft, prices and writes the
  // lines, records the cash tender, issues the receipt record and queues its
  // print. Route metadata (permission, profiles, risk class, audit event) is
  // read from the registry exactly as for confirm_intake — nothing restated.
  fromRoute("laundry.booking.confirm_from_draft", "laundry-booking-confirm-intake", "booking"),
  // ------------------------------------------------------------ Ready (T3)
  fromRoute("laundry.ready.open_session", "laundry-ready-session-open", "ready_session"),
  fromRoute("laundry.ready.record_scan", "laundry-ready-session-scan", "ready_session"),
  fromRoute("laundry.ready.record_qa", "laundry-ready-session-qa", "ready_session"),
  fromRoute("laundry.ready.record_exception", "laundry-ready-session-exception", "ready_session"),
  fromRoute("laundry.ready.assign_storage", "laundry-ready-session-storage", "ready_session"),
  fromRoute("laundry.ready.complete", "laundry-ready-session-complete", "ready_session"),
  // ----------------------------------------------------------- Pickup (T4)
  fromRoute("laundry.pickup.open_session", "laundry-pickup-session-open", "pickup_session"),
  fromRoute(
    "laundry.pickup.verify_collector",
    "laundry-pickup-session-verify-collector",
    "pickup_session"
  ),
  fromRoute("laundry.pickup.record_scan", "laundry-pickup-session-scan", "pickup_session"),
  fromRoute("laundry.pickup.record_payment", "laundry-pickup-session-payment", "pickup_session"),
  fromRoute("laundry.pickup.complete", "laundry-pickup-session-complete", "pickup_session"),
  // ------------------------------------------------------------- Payments
  // Cash is authoritative at the drawer: the drawer movement IS the evidence,
  // so a cash payment is recorded CONFIRMED (KBR-PAY-002).
  hubInternal("payments.record_cash_payment", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/payments",
    permission: "payments.capture.cash",
    allowedProfiles: [T1, T4],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "payment.recorded"
  }),
  // KLD-2026-07-26-002 Group 5: PAYMENT_PENDING is NON-TERMINAL (HTTP 202).
  // Pending is NOT paid, and no KHQR confirmation is ever fabricated.
  hubInternal("payments.create_pending_payment", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/payments",
    permission: "payments.khqr.create",
    allowedProfiles: [T1, T4],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "payment.recorded"
  }),
  // KBR-PAY-005: refund authorisation is separated and recorded. Thresholds are
  // an OPEN owner decision (PAY-OD-002) and are NOT invented, so the Hub takes
  // the strictest reading and requires four-eyes evidence for EVERY refund.
  hubInternal("payments.request_refund", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/refunds",
    permission: "payments.refund.request",
    allowedProfiles: [T1, T4],
    riskClass: "A3_FOUR_EYES",
    expectedVersionRequired: true,
    approvalRequired: true,
    auditEvent: "payment.refund_requested"
  }),
  hubInternal("payments.request_void", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/voids",
    permission: "payments.void.request",
    allowedProfiles: [T1, T4],
    riskClass: "A3_FOUR_EYES",
    expectedVersionRequired: true,
    approvalRequired: true,
    auditEvent: "payment.void_requested"
  }),
  // Registered so the gap is VISIBLE. Always fails closed as a terminal command.
  hubInternal("payments.apply_provider_callback", "payment", {
    routeTemplate: "/edge/v1/payments/{id}/provider-callbacks",
    permission: PERMISSION_GAP_HUB_PROVIDER_CALLBACK,
    allowedProfiles: [T1, T4],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "payment.recorded"
  })
];
var BY_TYPE = new Map(DEFINITIONS.map((d) => [d.commandType, d]));
var INACTIVE_ROUTE_COMMANDS = EDGE_ROUTES.filter(
  (route) => isRequiredPermissionMarker(route.permission)
).map((route) => fromRoute(`edge.${route.id.replace(/-/g, "_")}`, route.id, "booking"));
for (const definition of INACTIVE_ROUTE_COMMANDS) {
  BY_TYPE.set(definition.commandType, definition);
}
var HUB_COMMANDS = [
  ...DEFINITIONS,
  ...INACTIVE_ROUTE_COMMANDS
];
function requireActiveHubCommand(commandType) {
  const definition = BY_TYPE.get(commandType);
  if (!definition) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", `unknown command type '${commandType}'.`, {
      commandType
    });
  }
  if (!definition.active) {
    throw new HubCommandError(
      "EDGE_PERMISSION_KEY_UNREGISTERED",
      definition.inactiveReason ?? `command '${commandType}' is INACTIVE and fails closed until an owner decision registers its permission key.`,
      { commandType, permission: definition.permission }
    );
  }
  if (!isCanonicalPermissionKey(definition.permission)) {
    throw new HubCommandError(
      "EDGE_PERMISSION_KEY_UNREGISTERED",
      `command '${commandType}' declares permission '${definition.permission}', which is not in the canonical RBAC registry.`,
      { commandType, permission: definition.permission }
    );
  }
  return definition;
}

// src/hub/idempotency.ts
init_errors();
init_hub_database();
var WS09_WRITABLE_SYNC_STATES = [
  "committed_locally",
  "pending_cloud_sync",
  "reconciliation_required"
];
async function reserveOrLoadCommand(client, input) {
  if (!isCanonicalIdempotencyKey(input.idempotencyKey)) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      `'${input.idempotencyKey}' is not kl1.{terminal_device_uuid}.{client_sequence} (offline contract \xA72).`,
      { idempotencyKey: input.idempotencyKey }
    );
  }
  const parsed = parseIdempotencyKey(input.idempotencyKey);
  if (parsed.terminalDeviceId.toLowerCase() !== input.terminalDeviceId.toLowerCase()) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      `idempotency key names terminal ${parsed.terminalDeviceId} but the command was presented by ${input.terminalDeviceId}.`,
      { idempotencyKey: input.idempotencyKey }
    );
  }
  try {
    const result = await client.query(
      `select * from edge_sync.accept_terminal_command(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::char(64),
         $8::text, $9::text, $10::uuid, $11::bigint, $12::integer, $13::uuid)`,
      [
        input.commandResultId,
        input.tenantId,
        input.digitalStoreId,
        input.locationId,
        input.terminalDeviceId,
        input.idempotencyKey,
        input.requestHash,
        input.commandType,
        input.aggregateType,
        input.actorId,
        input.originSequence === null ? null : input.originSequence.toString(),
        input.assignmentGeneration,
        input.requestId
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new HubCommandError(
        "EDGE_TERMINAL_UNKNOWN",
        "edge_sync.accept_terminal_command returned no outcome row."
      );
    }
    return row;
  } catch (error) {
    const mapped = fromDatabaseError(error);
    if (mapped) {
      if (mapped.code === "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH") {
        throw new HubCommandError(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          `${mapped.message} (offline contract \xA73 EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH).`,
          { idempotencyKey: input.idempotencyKey, commandType: input.commandType }
        );
      }
      throw mapped;
    }
    throw error;
  }
}
async function completeCommand(client, input) {
  if (!WS09_WRITABLE_SYNC_STATES.includes(input.syncState)) {
    throw new HubCommandError(
      "EDGE_COMMAND_INACTIVE",
      `WS-09 may not persist sync_state '${input.syncState}'; cloud acknowledgement belongs to WS-10.`,
      { syncState: input.syncState }
    );
  }
  try {
    const result = await client.query(
      `select * from edge_sync.complete_command(
         $1::text, $2::text, $3::text, $4::uuid, $5::bigint, $6::uuid[],
         $7::bigint, $8::bigint, $9::text, $10::jsonb)`,
      [
        input.idempotencyKey,
        input.commitStatus,
        input.syncState,
        input.aggregateId,
        input.aggregateVersion === null ? null : input.aggregateVersion.toString(),
        [...input.eventIds],
        input.hubSequenceFirst === null ? null : input.hubSequenceFirst.toString(),
        input.hubSequenceLast === null ? null : input.hubSequenceLast.toString(),
        input.errorCode,
        JSON.stringify(input.resultJson)
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        `no in-progress command result for key ${input.idempotencyKey}.`
      );
    }
    return row;
  } catch (error) {
    const mapped = fromDatabaseError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

// src/hub/command-pipeline.ts
var MAX_CONCURRENCY_RETRIES = 12;
var RETRY_BASE_DELAY_MS = 12;
function isDuplicateKeyRace(error) {
  const err = error;
  return err?.code === "23505" && (err.constraint ?? "").includes("command_result");
}
async function backoff(attempt2) {
  const ceiling = RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt2, 6);
  const delay = Math.floor(Math.random() * ceiling) + 1;
  await new Promise((resolve) => setTimeout(resolve, delay));
}
async function executeHubCommand(pool, request, handler2) {
  const definition = requireActiveHubCommand(request.commandType);
  const requestId = request.requestId ?? uuidv7();
  const correlationId = request.correlationId ?? requestId;
  const requestHash = canonicalRequestHash({
    method: definition.method,
    routeTemplate: definition.routeTemplate,
    body: request.body,
    terminalDeviceId: request.device.terminalDeviceId,
    sessionId: request.device.sessionId,
    profileCode: request.device.profileCode
  });
  let attempt2 = 0;
  for (; ; ) {
    attempt2 += 1;
    const burntSequences = [];
    let recorderRef;
    try {
      return await withSerializableHubTransaction(pool, async (client) => {
        const auth = await authorizeHubCommand(client, definition, request.device, {
          ...request.targetScope ? { targetScope: request.targetScope } : {},
          ...request.approval ? { approval: request.approval } : {},
          ...request.requiredConditionalPermissions ? { requiredConditionalPermissions: request.requiredConditionalPermissions } : {}
        });
        const commandResultId = uuidv7();
        const reservation = await reserveOrLoadCommand(client, {
          commandResultId,
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          terminalDeviceId: request.device.terminalDeviceId,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          commandType: definition.commandType,
          aggregateType: definition.aggregateType,
          actorId: request.device.actorId,
          originSequence: request.clientSequence,
          assignmentGeneration: auth.assignmentGeneration,
          requestId
        });
        if (reservation.outcome !== "accepted") {
          const stored = await loadStoredResultJson(client, request.idempotencyKey);
          return storedResult(definition, request, reservation, requestId, stored);
        }
        const recorder = new HubEventRecorder(client, {
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          hubDeviceId: auth.hubDeviceId,
          originDeviceId: request.device.terminalDeviceId,
          actorId: request.device.actorId,
          actorType: auth.actorType === "terminal_device" ? "device" : "user",
          assignmentGeneration: auth.assignmentGeneration,
          businessDate: request.businessDate,
          correlationId,
          originSequence: request.clientSequence,
          commandIdempotencyKey: request.idempotencyKey,
          commandResultId,
          commandType: definition.commandType,
          declaredEffects: declaredEffects(definition)
        });
        recorderRef = recorder;
        const handled = await handler2({
          client,
          definition,
          auth,
          recorder,
          correlationId,
          requestId,
          idempotencyKey: request.idempotencyKey,
          body: request.body,
          businessDate: request.businessDate
        });
        const auditSequence = await sync_exports.allocateHubSequence(client);
        const auditDetails = {
          command_type: definition.commandType,
          permission: definition.permission,
          permission_source: auth.permissionSource,
          risk_class: definition.riskClass,
          request_id: requestId,
          ...handled.auditDetails ?? {}
        };
        await audit_exports.appendAuditEvent(client, {
          id: uuidv7(),
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          eventCode: definition.auditEvent,
          actorType: auth.actorType,
          actorId: request.device.actorId,
          requesterId: request.approval?.request.requestedBy ?? null,
          approverId: request.approval?.decision.approvedBy ?? null,
          terminalDeviceId: request.device.terminalDeviceId,
          hubDeviceId: auth.hubDeviceId,
          profileCode: auth.profile,
          resourceType: handled.auditResourceType,
          resourceId: handled.auditResourceId,
          reasonCode: handled.auditReasonCode ?? null,
          correlationId,
          payloadSha256: payloadChecksum(auditDetails),
          details: auditDetails,
          localSequence: auditSequence
        });
        const completion = await completeCommand(client, {
          idempotencyKey: request.idempotencyKey,
          commitStatus: "committed",
          syncState: "committed_locally",
          aggregateId: handled.aggregateId,
          aggregateVersion: handled.aggregateVersion,
          eventIds: recorder.eventIds,
          hubSequenceFirst: recorder.hubSequenceFirst,
          hubSequenceLast: recorder.hubSequenceLast,
          errorCode: null,
          resultJson: handled.resultJson
        });
        return {
          outcome: "accepted",
          commandType: definition.commandType,
          idempotencyKey: request.idempotencyKey,
          requestId,
          aggregateId: completion.aggregate_id,
          aggregateVersion: completion.aggregate_version,
          eventIds: recorder.eventIds,
          hubSequenceFirst: recorder.hubSequenceFirst,
          hubSequenceLast: recorder.hubSequenceLast,
          syncState: "committed_locally",
          wireSyncState: sync_exports.WS09_WIRE_SYNC_STATE,
          result: handled.resultJson
        };
      });
    } catch (error) {
      burntSequences.push(...recorderRef?.allocatedSequences ?? []);
      await journalBurntSequences(pool, request, burntSequences);
      if (attempt2 < MAX_CONCURRENCY_RETRIES && (isSerializationFailure(error) || isDuplicateKeyRace(error))) {
        await backoff(attempt2);
        continue;
      }
      const mapped = error instanceof HubCommandError ? error : fromDatabaseError(error);
      if (mapped) {
        await recordDenialEvidence(pool, request, mapped);
        throw mapped;
      }
      throw error;
    }
  }
}
async function loadStoredResultJson(client, idempotencyKey) {
  const found = await client.query(
    `select result_json, commit_status from edge_sync.command_result where idempotency_key = $1`,
    [idempotencyKey]
  );
  const row = found.rows[0];
  return row !== void 0 && row.commit_status === "committed" ? row.result_json : null;
}
function storedResult(definition, request, reservation, requestId, stored = null) {
  return {
    outcome: reservation.outcome === "in_progress" ? "in_progress" : "duplicate",
    commandType: definition.commandType,
    idempotencyKey: request.idempotencyKey,
    requestId,
    aggregateId: reservation.aggregate_id,
    aggregateVersion: reservation.aggregate_version,
    eventIds: reservation.event_ids ?? [],
    hubSequenceFirst: reservation.hub_sequence_first,
    hubSequenceLast: reservation.hub_sequence_last,
    syncState: "committed_locally",
    wireSyncState: sync_exports.WS09_WIRE_SYNC_STATE,
    result: { ...stored ?? {}, replayed: true }
  };
}
async function journalBurntSequences(pool, request, sequences) {
  if (sequences.length === 0) return;
  try {
    await withHubTransaction(pool, async (client) => {
      for (const hubSequence of sequences) {
        await sync_exports.recordSequenceGap(client, {
          id: uuidv7(),
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          assignmentGeneration: request.device.assignmentGeneration,
          hubSequence,
          gapReason: "transaction_rollback",
          recordedBy: "kitluy-hub-agent",
          note: `command ${request.commandType} rolled back`
        });
      }
    });
  } catch {
  }
}
var EVIDENCE_CODES = /* @__PURE__ */ new Set([
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH",
  "EDGE_IDEMPOTENCY_KEY_MALFORMED",
  "EDGE_SEQUENCE_REPLAY_REJECTED",
  "EDGE_SEQUENCE_GAP",
  "EDGE_SCOPE_MISMATCH",
  "EDGE_TERMINAL_UNKNOWN",
  "EDGE_DEVICE_CONTEXT_INVALID",
  "EDGE_DEVICE_NOT_ASSIGNED",
  "EDGE_DEVICE_REVOKED",
  "EDGE_ASSIGNMENT_GENERATION_MISMATCH",
  "EDGE_SESSION_INVALID",
  "EDGE_SESSION_EXPIRED",
  "EDGE_PROFILE_NOT_AUTHORIZED",
  "EDGE_PERMISSION_DENIED",
  "EDGE_PERMISSION_KEY_UNREGISTERED",
  "EDGE_RESOURCE_SCOPE_DENIED",
  "EDGE_ENVIRONMENT_DENIED",
  "EDGE_APPROVAL_REQUIRED",
  "EDGE_SELF_APPROVAL_FORBIDDEN"
]);
async function recordDenialEvidence(pool, request, error) {
  if (!EVIDENCE_CODES.has(error.code)) return;
  const severity = error.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" || error.code === "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH" || error.code === "EDGE_DEVICE_REVOKED" || error.code === "EDGE_SELF_APPROVAL_FORBIDDEN" ? "high" : "medium";
  try {
    await withHubTransaction(pool, async (client) => {
      await audit_exports.recordSecurityEvent(client, {
        id: uuidv7(),
        tenantId: request.device.tenantId,
        digitalStoreId: request.device.digitalStoreId,
        locationId: request.device.locationId,
        eventCode: error.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" ? "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH" : error.code,
        severity,
        deviceId: request.device.terminalDeviceId,
        certificateSerial: null,
        // Redacted evidence only — never a payload, credential or contact value.
        details: {
          command_type: request.commandType,
          idempotency_key: request.idempotencyKey,
          profile_code: request.device.profileCode,
          ...error.details
        }
      });
    });
  } catch {
  }
}

// src/hub/booking-status.ts
init_errors();
var PRODUCTION_TO_STATUS = {
  RECEIVED: "intake_confirmed",
  WASHING: "washing",
  DRYING: "drying",
  PRESSING: "pressing",
  QA_PACKAGING: "qa_packaging",
  READY: "ready",
  PICKED_UP: "picked_up"
};
var STATUS_TO_PRODUCTION = Object.fromEntries(
  PRODUCTION_STATES.map((state) => [PRODUCTION_TO_STATUS[state], state])
);
var LIFECYCLE_TO_STATUS = {
  DRAFT: "draft",
  "CONFIRMED/FINALIZED": "intake_confirmed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  VOIDED: "voided",
  ISSUE_HOLD: "issue_hold",
  "RETURN/REFUND": "return_refund"
};
function statusForProductionState(state) {
  return PRODUCTION_TO_STATUS[state];
}
function statusForLifecycleState(state) {
  const status = LIFECYCLE_TO_STATUS[state];
  if (status === void 0) {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `Booking lifecycle state ${state} has no Hub-local projection value.`,
      { lifecycleState: state }
    );
  }
  return status;
}

// src/hub/commands/confirm-from-draft.ts
init_hub_database();

// src/hub/commands/print-commands.ts
init_db();
init_errors();
async function enqueueReceiptPrint(client, input) {
  const binding = await config_exports.findPeripheralBinding(
    client,
    input.locationId,
    input.logicalRole ?? "receipt_printer"
  );
  if (!binding) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `Location ${input.locationId} has no enabled '${input.logicalRole ?? "receipt_printer"}' peripheral binding.`,
      { locationId: input.locationId }
    );
  }
  return documents_exports.enqueuePrintJob(client, {
    id: uuidv7(),
    tenantId: input.tenantId,
    digitalStoreId: input.digitalStoreId,
    locationId: input.locationId,
    documentType: input.documentType,
    documentId: input.documentId,
    printerBindingId: binding.id,
    templateVersion: input.templateVersion,
    payloadSha256: input.payloadSha256,
    copies: input.copies ?? 1,
    copyIndex: input.copyIndex ?? 1,
    priority: 0,
    createdBy: input.createdBy,
    terminalDeviceId: input.terminalDeviceId
  });
}

// src/hub/commands/payment-commands.ts
init_db();
init_errors();

// src/hub/commands/shared.ts
init_errors();
var REQUIRED_LOCATION_CODE = "[REQUIRED: cloud-assigned immutable LOCATION_CODE (3-8 chars, Appendix B display profile) \u2014 the Hub-local schema carries no location_code column and the active configuration snapshot's fixture sections do not publish one]";
function requireLocationCode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{1,14})?[A-Za-z0-9]$/.test(value) || value.length < 3) {
    throw new HubCommandError("EDGE_REQUIRED_VALUE_MISSING", REQUIRED_LOCATION_CODE, {
      field: "location_code"
    });
  }
  return value;
}

// src/hub/commands/booking-commands.ts
init_errors();

// src/hub/commands/payment-commands.ts
init_hub_database();
function postingDeduplicationKey(sourceType, sourceId) {
  return sha256Hex2(canonicalJson({ source_type: sourceType, source_id: sourceId }));
}

// src/hub/commands/confirm-from-draft.ts
var CONFIRM_FROM_DRAFT_COMMAND = "laundry.booking.confirm_from_draft";
var TENDER_RECORDED_EVENT_NAME = "payment.tender_recorded";
var RECEIPT_ISSUED_EVENT_NAME = "document.receipt_issued";
var BOOKING_RECEIPT_DOCUMENT_TYPE = "booking_receipt";
var BOOKING_RECEIPT_TEMPLATE_VERSION = 1n;
var MAX_INTAKE_LINES = 200;
async function loadIntakePricingSections(client, locationId) {
  const active = await config_exports.findActiveConfiguration(client, locationId);
  if (!active) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `Location ${locationId} has no ACTIVE configuration snapshot; the Hub refuses to price without one.`,
      { locationId, result: "CONFIGURATION_MISSING" }
    );
  }
  const pricing = await config_exports.findConfigurationSection(client, active.snapshot_id, "pricing");
  const money2 = pricing === void 0 ? null : parseLaundryMoneySection(pricing.content_json);
  if (money2 === null) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `configuration snapshot ${active.snapshot_id} carries no kitluy.config.money.v1 'pricing' section.`,
      {
        snapshotId: active.snapshot_id,
        result: "MONEY_CONTRACT_MISSING"
      }
    );
  }
  const catalogSection = await config_exports.findConfigurationSection(
    client,
    active.snapshot_id,
    "catalog"
  );
  const catalog = catalogSection === void 0 ? null : parseLaundryCatalogSection(catalogSection.content_json);
  if (catalog === null) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `configuration snapshot ${active.snapshot_id} carries no kitluy.config.catalog.v1 'catalog' section.`,
      {
        snapshotId: active.snapshot_id,
        result: "CATALOG_NOT_DELIVERED"
      }
    );
  }
  return {
    snapshotId: active.snapshot_id,
    snapshotVersion: active.snapshot_version,
    catalog,
    money: money2
  };
}
function priceIntakeOrRefuse(sections, lines, express) {
  const priced = quoteIntakeLines(sections.catalog, sections.money, lines, { express });
  if (!priced.ok) {
    const { code, ...rest } = priced.refusal;
    throw new HubCommandError(
      code === "NO_LINES" || code === "QUANTITY_INVALID" ? "EDGE_INVALID_TRANSITION" : code === "WEIGHT_RULE_MISSING" || code === "MONEY_ROUNDING_UNKNOWN" || code === "EXPRESS_NOT_CONFIGURED" ? "EDGE_CONFIGURATION_MISSING" : "EDGE_REQUIRED_VALUE_MISSING",
      `the Hub cannot price this intake: ${code}.`,
      { result: code, ...rest }
    );
  }
  return priced.quote;
}
function settleOrRefuse(totalMinor, money2, tender) {
  const settled = settleCashTender(totalMinor, money2, tender);
  if (!settled.ok) {
    const { code, ...rest } = settled.refusal;
    throw new HubCommandError(
      code === "FX_RATE_UNAVAILABLE" ? "EDGE_CONFIGURATION_MISSING" : "EDGE_INVALID_TRANSITION",
      `the tender does not settle this Booking: ${code}.`,
      {
        result: code,
        ...Object.fromEntries(
          Object.entries(rest).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])
        )
      }
    );
  }
  return settled.settlement;
}
async function loadScopedDraftForUpdate(execution, draftId) {
  const device = execution.auth.device;
  const found = await execution.client.query(
    `select * from edge_laundry.booking_draft
      where id = $1::uuid and tenant_id = $2::uuid and digital_store_id = $3::uuid
        and location_id = $4::uuid
      for update`,
    [draftId, device.tenantId, device.digitalStoreId, device.locationId]
  );
  const draft = found.rows[0];
  if (draft === void 0) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_NOT_FOUND",
      `draft ${draftId} is not in this scope.`,
      {
        draftId,
        result: "DRAFT_UNKNOWN"
      }
    );
  }
  return draft;
}
var s = (value) => value.toString();
async function confirmBookingFromDraft(pool, input) {
  const body = {
    draft_id: input.draftId,
    expected_version: input.expectedVersion,
    express: input.express,
    displayed_total_minor: s(input.displayedTotalMinor),
    tender: {
      type: "cash",
      local_minor: s(input.tender.localMinor),
      usd_cents: s(input.tender.usdCents)
    },
    lines: input.lines.map((line) => ({
      service_id: line.serviceId.toLowerCase(),
      ...line.pieceCount === void 0 ? {} : { piece_count: line.pieceCount },
      ...line.weighedGrams === void 0 ? {} : { weighed_grams: line.weighedGrams }
    }))
  };
  return executeHubCommand(
    pool,
    {
      commandType: CONFIRM_FROM_DRAFT_COMMAND,
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...input.requestId ? { requestId: input.requestId } : {},
      ...input.correlationId ? { correlationId: input.correlationId } : {}
    },
    async (execution) => handler(execution, input, body)
  );
}
async function handler(execution, input, body) {
  const { client, auth } = execution;
  const device = auth.device;
  const draft = await loadScopedDraftForUpdate(execution, input.draftId);
  if (draft.lifecycle !== "open") {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `draft ${draft.id} is ${draft.lifecycle}; only an open draft can be confirmed.`,
      {
        draftId: draft.id,
        lifecycle: draft.lifecycle,
        convertedBookingId: draft.converted_booking_id,
        result: "DRAFT_NOT_OPEN"
      }
    );
  }
  const draftVersion = Number(draft.version);
  if (draftVersion !== input.expectedVersion) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `draft ${draft.id} is at version ${String(draftVersion)}, expected ${String(input.expectedVersion)}.`,
      {
        draftId: draft.id,
        actual: draftVersion,
        expected: input.expectedVersion,
        result: "DRAFT_VERSION_STALE"
      }
    );
  }
  const sections = await loadIntakePricingSections(client, device.locationId);
  const quote = priceIntakeOrRefuse(sections, input.lines, input.express);
  if (quote.totalMinor !== input.displayedTotalMinor) {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `the terminal displayed ${s(input.displayedTotalMinor)} but the Hub prices ${s(quote.totalMinor)} ${quote.currencyCode}.`,
      {
        result: "PRICE_MISMATCH",
        hubTotalMinor: s(quote.totalMinor),
        displayedTotalMinor: s(input.displayedTotalMinor),
        currencyCode: quote.currencyCode
      }
    );
  }
  const settlement = settleOrRefuse(quote.totalMinor, sections.money, input.tender);
  const locationCode = requireLocationCode(sections.money.locationCode);
  transitionBooking("DRAFT", "CONFIRMED/FINALIZED");
  const fromStatus = statusForLifecycleState("DRAFT");
  const status = statusForProductionState("RECEIVED");
  const bookingNumber = await laundry_exports.formatDisplayNumber(
    client,
    "KLB",
    locationCode,
    execution.businessDate,
    await laundry_exports.allocateBusinessNumber(
      client,
      device.locationId,
      "booking",
      execution.businessDate
    )
  );
  const bookingId = uuidv7();
  await laundry_exports.insertBooking(client, {
    id: bookingId,
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
    bookingNumber,
    customerId: draft.customer_id,
    status,
    businessDate: execution.businessDate,
    currencyCode: quote.currencyCode,
    currencyExponent: quote.currencyExponent,
    subtotalMinor: quote.subtotalMinor,
    discountMinor: 0n,
    // The express surcharge is a priced addition, carried as the tax slot's
    // sibling would be if there were one: totals = subtotal + surcharge.
    taxMinor: quote.expressSurchargeMinor,
    totalMinor: quote.totalMinor,
    dueAt: null,
    pickupMethod: "store_pickup",
    configSnapshotId: sections.snapshotId
  });
  const lineIds = [];
  for (const line of quote.lines) {
    const lineId = uuidv7();
    lineIds.push(lineId);
    await laundry_exports.insertBookingLine(client, {
      id: lineId,
      tenantId: device.tenantId,
      digitalStoreId: device.digitalStoreId,
      locationId: device.locationId,
      bookingId,
      serviceId: line.serviceId,
      serviceVersion: BigInt(line.serviceVersion),
      displayName: line.displayName,
      pricingMethod: line.pricingMethod,
      unitPriceMinor: line.unitPriceMinor,
      currencyCode: quote.currencyCode,
      currencyExponent: quote.currencyExponent,
      quantity: line.quantity,
      unitCode: line.unitCode,
      lineSubtotalMinor: line.lineSubtotalMinor,
      discountMinor: 0n,
      taxMinor: 0n,
      lineTotalMinor: line.lineSubtotalMinor,
      addonSnapshot: {
        service_code: line.serviceCode,
        family_code: line.familyCode,
        ...line.weighedGrams === null ? {} : { weighed_grams: line.weighedGrams, billable_grams: line.billableGrams }
      },
      sourceConfigVersion: sections.snapshotVersion
    });
  }
  let version = 1n;
  const bookingPayload = {
    booking_id: bookingId,
    booking_number: bookingNumber,
    hub_draft_id: draft.id,
    from_status: fromStatus,
    to_status: status,
    walk_in: draft.walk_in,
    local_customer_id: draft.customer_id,
    customer_snapshot: draft.customer_snapshot,
    preferred_language: draft.preferred_language,
    intake_source: draft.intake_source,
    customer_notes: draft.customer_notes,
    staff_notes: draft.staff_notes,
    currency_code: quote.currencyCode,
    currency_exponent: quote.currencyExponent,
    subtotal_minor: s(quote.subtotalMinor),
    express: quote.express,
    express_surcharge_bps: quote.expressSurchargeBps,
    express_surcharge_minor: s(quote.expressSurchargeMinor),
    total_minor: s(quote.totalMinor),
    line_count: quote.lines.length,
    lines: quote.lines.map((line, index) => ({
      booking_line_id: lineIds[index],
      service_id: line.serviceId,
      service_code: line.serviceCode,
      service_version: line.serviceVersion,
      display_name: line.displayName,
      family_code: line.familyCode,
      pricing_method: line.pricingMethod,
      unit_code: line.unitCode,
      unit_price_minor: s(line.unitPriceMinor),
      quantity: line.quantity,
      piece_count: line.pieceCount,
      weighed_grams: line.weighedGrams,
      billable_grams: line.billableGrams,
      line_subtotal_minor: s(line.lineSubtotalMinor)
    })),
    config_snapshot_id: sections.snapshotId,
    config_snapshot_version: s(sections.snapshotVersion)
  };
  const bookingEvent = await execution.recorder.record({
    aggregateType: "booking",
    aggregateId: bookingId,
    aggregateVersion: version,
    eventName: execution.definition.auditEvent,
    payload: bookingPayload
  });
  await laundry_exports.appendStatusEvent(client, {
    id: uuidv7(),
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
    bookingId,
    fromStatus,
    toStatus: status,
    reasonCode: null,
    actorId: device.actorId,
    terminalDeviceId: device.terminalDeviceId,
    localSequence: await laundry_exports.nextBookingLocalSequence(client, "status_event", bookingId),
    eventId: bookingEvent.eventId
  });
  let paymentId = null;
  let paymentNumber = null;
  let cashMovementId = null;
  if (settlement.appliedMinor > 0n) {
    paymentId = uuidv7();
    paymentNumber = await laundry_exports.formatDisplayNumber(
      client,
      "KLP",
      locationCode,
      execution.businessDate,
      await laundry_exports.allocateBusinessNumber(
        client,
        device.locationId,
        "payment",
        execution.businessDate
      )
    );
    const paymentPayload = {
      booking_id: bookingId,
      booking_number: bookingNumber,
      payment_id: paymentId,
      payment_number: paymentNumber,
      payment_type: "cash",
      amount_minor: s(settlement.appliedMinor),
      tendered_minor: s(settlement.tenderedMinor),
      change_due_minor: s(settlement.changeDueMinor),
      currency_code: settlement.currencyCode,
      currency_exponent: settlement.currencyExponent,
      payment_state: "confirmed",
      is_paid: true,
      // KBR-PAY-004: cash in full at intake settles the Booking; it is not a deposit.
      allocation: "settlement",
      legs: settlement.legs.map((leg) => ({
        tender_type: leg.tenderType,
        currency_code: leg.currencyCode,
        currency_exponent: leg.currencyExponent,
        amount_minor: s(leg.amountMinor),
        local_equivalent_minor: s(leg.localEquivalentMinor),
        khr_per_usd: leg.khrPerUsd
      })),
      posting_dedup_key: postingDeduplicationKey("payment", paymentId),
      settlement_reference: null,
      // The Hub genuinely does not know the cloud posting outcome (WS-10 owns it).
      cloud_posting_status: "unknown"
    };
    const paymentEvent = await execution.recorder.record({
      aggregateType: "payment",
      aggregateId: paymentId,
      aggregateVersion: 1n,
      eventName: "payment.recorded",
      payload: paymentPayload,
      causationId: bookingEvent.eventId
    });
    await payments_exports.insertPayment(client, {
      id: paymentId,
      tenantId: device.tenantId,
      digitalStoreId: device.digitalStoreId,
      locationId: device.locationId,
      bookingId,
      paymentNumber,
      paymentType: "cash",
      amountMinor: settlement.appliedMinor,
      currencyCode: settlement.currencyCode,
      currencyExponent: settlement.currencyExponent,
      state: "confirmed",
      providerCode: null,
      providerReference: null,
      confirmed: true,
      actorId: device.actorId,
      terminalDeviceId: device.terminalDeviceId,
      eventId: paymentEvent.eventId,
      // KLREQ-026: the payment ROW carries the TERMINAL COMMAND key.
      idempotencyKey: execution.idempotencyKey
    });
    for (const leg of settlement.legs) {
      const legEvent = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: paymentId,
        aggregateVersion: 1n,
        eventName: TENDER_RECORDED_EVENT_NAME,
        payload: {
          booking_id: bookingId,
          payment_id: paymentId,
          tender_type: leg.tenderType,
          currency_code: leg.currencyCode,
          currency_exponent: leg.currencyExponent,
          amount_minor: s(leg.amountMinor),
          local_currency_code: settlement.currencyCode,
          local_equivalent_minor: s(leg.localEquivalentMinor),
          khr_per_usd: leg.khrPerUsd
        },
        causationId: paymentEvent.eventId
      });
      await payments_exports.insertTenderLeg(client, {
        id: uuidv7(),
        tenantId: device.tenantId,
        digitalStoreId: device.digitalStoreId,
        locationId: device.locationId,
        paymentId,
        tenderType: leg.tenderType,
        amountMinor: leg.amountMinor,
        currencyCode: leg.currencyCode,
        currencyExponent: leg.currencyExponent,
        state: "settled",
        providerReference: null,
        eventId: legEvent.eventId
      });
    }
    const paid = await laundry_exports.updateBookingProjection(client, {
      bookingId,
      expectedVersion: version,
      paidMinor: settlement.appliedMinor
    });
    if (paid === void 0) {
      throw new HubCommandError(
        "EDGE_AGGREGATE_VERSION_CONFLICT",
        `Booking ${bookingId} changed concurrently while recording the payment.`
      );
    }
    version = paid;
    const shift = await payments_exports.findOpenShift(
      client,
      device.locationId,
      device.terminalDeviceId
    );
    if (shift) {
      const movementEvent = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: paymentId,
        aggregateVersion: 1n,
        eventName: "cash.movement_recorded",
        payload: {
          booking_id: bookingId,
          payment_id: paymentId,
          shift_id: shift.id,
          movement_type: "payment_received",
          amount_minor: s(settlement.appliedMinor),
          currency_code: settlement.currencyCode,
          currency_exponent: settlement.currencyExponent,
          posting_dedup_key: postingDeduplicationKey("cash_movement", paymentId),
          cloud_posting_status: "unknown"
        },
        causationId: paymentEvent.eventId
      });
      cashMovementId = uuidv7();
      await payments_exports.insertCashMovement(client, {
        id: cashMovementId,
        tenantId: device.tenantId,
        digitalStoreId: device.digitalStoreId,
        locationId: device.locationId,
        shiftId: shift.id,
        movementType: "payment_received",
        amountMinor: settlement.appliedMinor,
        currencyCode: settlement.currencyCode,
        currencyExponent: settlement.currencyExponent,
        reasonCode: null,
        relatedPaymentId: paymentId,
        actorId: device.actorId,
        terminalDeviceId: device.terminalDeviceId,
        eventId: movementEvent.eventId
      });
    }
  }
  const receiptId = uuidv7();
  const receiptNumber = await laundry_exports.formatDisplayNumber(
    client,
    "KLR",
    locationCode,
    execution.businessDate,
    await laundry_exports.allocateBusinessNumber(
      client,
      device.locationId,
      "receipt",
      execution.businessDate
    )
  );
  const issuedAt = (await client.query(`select now() as now`)).rows[0]?.now ?? /* @__PURE__ */ new Date();
  const receiptPayload = {
    document_type: BOOKING_RECEIPT_DOCUMENT_TYPE,
    template_version: s(BOOKING_RECEIPT_TEMPLATE_VERSION),
    receipt_id: receiptId,
    receipt_number: receiptNumber,
    /** The Hub's transaction clock — the same instant the receipt row carries. */
    issued_at: issuedAt.toISOString(),
    booking_id: bookingId,
    booking_number: bookingNumber,
    business_date: execution.businessDate,
    location_code: locationCode,
    customer: draft.walk_in ? { walk_in: true } : draft.customer_snapshot,
    preferred_language: draft.preferred_language,
    currency_code: quote.currencyCode,
    currency_exponent: quote.currencyExponent,
    lines: bookingPayload.lines,
    subtotal_minor: s(quote.subtotalMinor),
    express: quote.express,
    express_surcharge_minor: s(quote.expressSurchargeMinor),
    total_minor: s(quote.totalMinor),
    payment: paymentId === null ? null : {
      payment_id: paymentId,
      payment_number: paymentNumber,
      payment_type: "cash",
      amount_minor: s(settlement.appliedMinor),
      tendered_minor: s(settlement.tenderedMinor),
      change_due_minor: s(settlement.changeDueMinor),
      legs: settlement.legs.map((leg) => ({
        currency_code: leg.currencyCode,
        currency_exponent: leg.currencyExponent,
        amount_minor: s(leg.amountMinor),
        local_equivalent_minor: s(leg.localEquivalentMinor),
        khr_per_usd: leg.khrPerUsd
      }))
    },
    paid_minor: s(settlement.appliedMinor),
    balance_minor: s(quote.totalMinor - settlement.appliedMinor)
  };
  const receiptSha256 = sha256Hex2(canonicalJson(receiptPayload));
  const receiptEvent = await execution.recorder.record({
    aggregateType: "booking",
    aggregateId: bookingId,
    aggregateVersion: version,
    eventName: RECEIPT_ISSUED_EVENT_NAME,
    payload: {
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      booking_id: bookingId,
      booking_number: bookingNumber,
      payment_id: paymentId,
      document_type: BOOKING_RECEIPT_DOCUMENT_TYPE,
      template_version: s(BOOKING_RECEIPT_TEMPLATE_VERSION),
      content_sha256: receiptSha256
    },
    causationId: bookingEvent.eventId
  });
  await documents_exports.insertReceipt(client, {
    id: receiptId,
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
    bookingId,
    paymentId,
    receiptNumber,
    documentType: BOOKING_RECEIPT_DOCUMENT_TYPE,
    templateVersion: BOOKING_RECEIPT_TEMPLATE_VERSION,
    contentSha256: receiptSha256,
    issuedBy: device.actorId,
    eventId: receiptEvent.eventId
  });
  let printJobId = null;
  let printState = "no_printer_binding";
  const binding = await config_exports.findPeripheralBinding(
    client,
    device.locationId,
    "receipt_printer"
  );
  if (binding) {
    printJobId = await enqueueReceiptPrint(client, {
      tenantId: device.tenantId,
      digitalStoreId: device.digitalStoreId,
      locationId: device.locationId,
      documentType: BOOKING_RECEIPT_DOCUMENT_TYPE,
      documentId: receiptId,
      templateVersion: BOOKING_RECEIPT_TEMPLATE_VERSION,
      payloadSha256: receiptSha256,
      createdBy: device.actorId,
      terminalDeviceId: device.terminalDeviceId
    });
    printState = "queued";
  }
  const draftVersionAfter = draftVersion + 1;
  const converted = await client.query(
    `update edge_laundry.booking_draft
        set lifecycle = 'converted', converted_booking_id = $2::uuid, version = $3
      where id = $1::uuid
      returning updated_at, created_at, sync_state`,
    [draft.id, bookingId, draftVersionAfter]
  );
  const draftAfter = converted.rows[0];
  if (draftAfter === void 0) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `draft ${draft.id} changed concurrently; nothing was written.`
    );
  }
  const draftReceiptId = uuidv7();
  const draftChanges = { lifecycle: "converted", converted_booking_id: bookingId };
  await client.query(
    `insert into edge_laundry.booking_draft_event
       (id, draft_id, event_type, request_key, request_hash, changes,
        version_after, actor_id, terminal_device_id, session_id, correlation_id)
     values ($1::uuid, $2::uuid, 'updated', $3, $4, $5::jsonb, $6, $7::uuid, $8::uuid,
             $9::uuid, $10::uuid)`,
    [
      draftReceiptId,
      draft.id,
      execution.idempotencyKey,
      sha256Hex2(canonicalJson(body)),
      JSON.stringify(draftChanges),
      draftVersionAfter,
      device.actorId,
      device.terminalDeviceId,
      device.sessionId,
      execution.correlationId
    ]
  );
  await execution.recorder.record({
    aggregateType: "booking_draft",
    aggregateId: draft.id,
    aggregateVersion: BigInt(draftVersionAfter),
    eventName: BOOKING_DRAFT_EVENT_NAME,
    payload: {
      booking_draft_event_id: draftReceiptId,
      hub_draft_id: draft.id,
      event_type: "updated",
      tenant_id: device.tenantId,
      digital_store_id: device.digitalStoreId,
      location_id: device.locationId,
      walk_in: draft.walk_in,
      local_customer_id: draft.customer_id,
      customer_snapshot: draft.customer_snapshot,
      lifecycle: "converted",
      converted_booking_id: bookingId,
      version: draftVersionAfter,
      preferred_language: draft.preferred_language,
      intake_source: draft.intake_source,
      cancel_reason_code: null,
      hub_created_at: draftAfter.created_at.toISOString(),
      hub_updated_at: draftAfter.updated_at.toISOString(),
      correlation_id: execution.correlationId
    },
    causationId: bookingEvent.eventId
  });
  const finalBooking = await laundry_exports.findBooking(client, bookingId);
  const resultJson = {
    booking: {
      booking_id: bookingId,
      booking_number: bookingNumber,
      status,
      currency_code: quote.currencyCode,
      currency_exponent: quote.currencyExponent,
      subtotal_minor: s(quote.subtotalMinor),
      express: quote.express,
      express_surcharge_minor: s(quote.expressSurchargeMinor),
      total_minor: s(quote.totalMinor),
      paid_minor: s(settlement.appliedMinor),
      balance_minor: s(finalBooking?.balance_minor ?? quote.totalMinor - settlement.appliedMinor),
      line_count: quote.lines.length,
      aggregate_version: s(finalBooking?.aggregate_version ?? version)
    },
    lines: bookingPayload.lines,
    payment: paymentId === null ? null : {
      payment_id: paymentId,
      payment_number: paymentNumber,
      amount_minor: s(settlement.appliedMinor),
      tendered_minor: s(settlement.tenderedMinor),
      change_due_minor: s(settlement.changeDueMinor),
      currency_code: settlement.currencyCode,
      currency_exponent: settlement.currencyExponent,
      legs: receiptPayload.payment?.legs ?? [],
      cash_movement_id: cashMovementId
    },
    receipt: {
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      content_sha256: receiptSha256,
      payload: receiptPayload,
      print_job_id: printJobId,
      print_state: printState
    },
    draft: {
      draft_id: draft.id,
      lifecycle: "converted",
      version: draftVersionAfter,
      converted_booking_id: bookingId
    }
  };
  return {
    aggregateId: bookingId,
    aggregateVersion: finalBooking?.aggregate_version ?? version,
    resultJson,
    auditResourceType: "booking",
    auditResourceId: bookingId,
    auditDetails: {
      hub_draft_id: draft.id,
      booking_number: bookingNumber,
      total_minor: s(quote.totalMinor),
      payment_id: paymentId,
      receipt_id: receiptId,
      payload_sha256: payloadChecksum(bookingPayload)
    }
  };
}

// src/hub/edge/t1-operations.ts
init_db();
init_errors();
var s2 = (value) => value.toString();
async function quoteDraftIntake(pool, authority, input) {
  return withHubTransaction(
    pool,
    async (client) => {
      const draft = await client.query(
        `select lifecycle, converted_booking_id from edge_laundry.booking_draft
          where id = $1::uuid and tenant_id = $2::uuid and digital_store_id = $3::uuid
            and location_id = $4::uuid`,
        [input.draftId, authority.tenantId, authority.digitalStoreId, authority.locationId]
      );
      const row = draft.rows[0];
      if (row === void 0) {
        throw new HubCommandError("EDGE_AGGREGATE_NOT_FOUND", "no such draft in this scope", {
          result: "DRAFT_UNKNOWN"
        });
      }
      if (row.lifecycle !== "open") {
        throw new HubCommandError("EDGE_INVALID_TRANSITION", `draft is ${row.lifecycle}`, {
          result: "DRAFT_NOT_OPEN",
          lifecycle: row.lifecycle,
          convertedBookingId: row.converted_booking_id
        });
      }
      const sections = await loadIntakePricingSections(client, authority.locationId);
      const quote = priceIntakeOrRefuse(sections, input.lines, input.express);
      return {
        currencyCode: quote.currencyCode,
        currencyExponent: quote.currencyExponent,
        lines: quote.lines.map((line) => ({
          serviceId: line.serviceId,
          serviceCode: line.serviceCode,
          displayName: line.displayName,
          familyCode: line.familyCode,
          pricingMethod: line.pricingMethod,
          unitCode: line.unitCode,
          unitPriceMinor: s2(line.unitPriceMinor),
          quantity: line.quantity,
          pieceCount: line.pieceCount,
          weighedGrams: line.weighedGrams,
          billableGrams: line.billableGrams,
          lineSubtotalMinor: s2(line.lineSubtotalMinor)
        })),
        subtotalMinor: s2(quote.subtotalMinor),
        express: quote.express,
        expressSurchargeBps: quote.expressSurchargeBps,
        expressSurchargeMinor: s2(quote.expressSurchargeMinor),
        totalMinor: s2(quote.totalMinor),
        khrPerUsd: sections.money.khrPerUsd,
        locationCode: sections.money.locationCode,
        configurationVersion: s2(sections.snapshotVersion)
      };
    },
    HUB_RUNTIME_ROLE
  );
}
async function deviceContextFromAuthority(client, input) {
  if (!isCanonicalIdempotencyKey(input.idempotencyKey)) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      "the command key is not kl1.{terminal_device_uuid}.{client_sequence} (offline contract \xA72).",
      { result: "EDGE_IDEMPOTENCY_KEY_MALFORMED" }
    );
  }
  const parsed = parseIdempotencyKey(input.idempotencyKey);
  if (parsed.terminalDeviceId.toLowerCase() !== input.terminalDeviceId.toLowerCase()) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      "the command key names a different terminal than the authenticated one.",
      { result: "EDGE_IDEMPOTENCY_KEY_MALFORMED" }
    );
  }
  const terminal = await client.query(
    `select assignment_generation from edge_identity.terminal_device where id = $1::uuid`,
    [input.terminalDeviceId]
  );
  const row = terminal.rows[0];
  if (row === void 0) {
    throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "the terminal projection is missing");
  }
  return {
    device: {
      terminalDeviceId: input.terminalDeviceId,
      sessionId: input.authority.sessionId,
      actorId: input.authority.actorId,
      profileCode: input.authority.profileCode,
      assignmentGeneration: row.assignment_generation,
      tenantId: input.authority.tenantId,
      digitalStoreId: input.authority.digitalStoreId,
      locationId: input.authority.locationId,
      environment: input.environment
    },
    clientSequence: parsed.clientSequence
  };
}
async function hubBusinessDate(pool) {
  return withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query(
        `select to_char(current_date, 'YYYY-MM-DD') as d`
      );
      return result.rows[0]?.d ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    },
    HUB_RUNTIME_ROLE
  );
}
async function confirmDraftIntakeForTerminal(pool, input) {
  const context = await withHubTransaction(
    pool,
    (client) => deviceContextFromAuthority(client, {
      terminalDeviceId: input.terminalDeviceId,
      authority: input.authority,
      environment: input.environment,
      idempotencyKey: input.idempotencyKey
    }),
    HUB_RUNTIME_ROLE
  );
  return confirmBookingFromDraft(pool, {
    device: context.device,
    idempotencyKey: input.idempotencyKey,
    clientSequence: context.clientSequence,
    businessDate: await hubBusinessDate(pool),
    correlationId: input.correlationId,
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    lines: input.lines,
    express: input.express,
    displayedTotalMinor: input.displayedTotalMinor,
    tender: input.tender
  });
}
var RECENT_BOOKINGS_LIMIT = 50;
async function listRecentBookings(pool, authority) {
  return withHubTransaction(
    pool,
    async (client) => {
      const rows = await client.query(
        `select b.id, b.booking_number, b.status, to_char(b.business_date, 'YYYY-MM-DD') as business_date,
                b.currency_code, b.currency_exponent,
                b.total_minor::text as total_minor, b.paid_minor::text as paid_minor,
                b.balance_minor::text as balance_minor,
                (select count(*)::text from edge_laundry.booking_line l where l.booking_id = b.id) as line_count,
                coalesce(d.customer_snapshot ->> 'displayName', c.display_name) as customer_display_name,
                coalesce(d.walk_in, b.customer_id is null) as walk_in,
                (select r.receipt_number from edge_documents.receipt r
                  where r.booking_id = b.id order by r.issued_at desc limit 1) as receipt_number,
                b.created_at
           from edge_laundry.booking b
           left join edge_laundry.booking_draft d on d.converted_booking_id = b.id
           left join edge_core.customer c on c.id = b.customer_id
          where b.tenant_id = $1::uuid and b.digital_store_id = $2::uuid
            and b.location_id = $3::uuid and b.business_date = current_date
          order by b.created_at desc
          limit $4`,
        [authority.tenantId, authority.digitalStoreId, authority.locationId, RECENT_BOOKINGS_LIMIT]
      );
      return rows.rows.map((row) => ({
        bookingId: row.id,
        bookingNumber: row.booking_number,
        status: row.status,
        businessDate: row.business_date,
        currencyCode: row.currency_code,
        currencyExponent: row.currency_exponent,
        totalMinor: row.total_minor,
        paidMinor: row.paid_minor,
        balanceMinor: row.balance_minor,
        lineCount: Number(row.line_count),
        customerDisplayName: row.customer_display_name,
        walkIn: row.walk_in,
        receiptNumber: row.receipt_number,
        createdAt: row.created_at.toISOString()
      }));
    },
    HUB_RUNTIME_ROLE
  );
}

// src/hub/edge/routes.ts
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HEX643 = /^[0-9a-f]{64}$/;
var SIGNATURE_B64URL = /^[A-Za-z0-9_-]{1,120}$/;
var IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,96}$/;
var PROFILE2 = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
var MAX_PEM_CHARS = 1024;
var WELL_KNOWN_DISCOVERY_PATH = "/.well-known/kitluy-edge-discovery/v1";
var EDGE_ACTIVATION_CHALLENGES_PATH = "/edge/v1/terminal-activation/challenges";
var EDGE_ACTIVATION_COMPLETE_PATH = "/edge/v1/terminal-activation/complete";
var EDGE_PAIRING_SESSIONS_PATH = "/edge/v1/terminal-pairing/sessions";
var EDGE_TERMINAL_HEALTH_HEARTBEATS_PATH = "/edge/v1/terminal-health/heartbeats";
var MAX_HEARTBEAT_BODY_BYTES = 4 * 1024;
var EDGE_RUNTIME_AUTHORITY_TIME_PATH = "/edge/v1/runtime/authority-time";
var EDGE_RUNTIME_ELIGIBILITY_PATH = "/edge/v1/runtime/eligibility";
var EDGE_CONFIGURATION_CURRENT_PATH = "/edge/v1/configuration/current";
var EDGE_SESSIONS_OPEN_PATH = "/edge/v1/sessions/open";
var EDGE_SESSIONS_REFRESH_PATH = "/edge/v1/sessions/refresh";
var EDGE_SESSIONS_CLOSE_PATH = "/edge/v1/sessions/close";
var EDGE_TERMINAL_PIN_STATUS_PATH = "/edge/v1/terminal-pin/status";
var EDGE_TERMINAL_PIN_SETUP_PATH = "/edge/v1/terminal-pin/setup";
var EDGE_TERMINAL_PIN_UNLOCK_PATH = "/edge/v1/terminal-pin/unlock";
var EDGE_TERMINAL_PIN_CHANGE_PATH = "/edge/v1/terminal-pin/change";
var EDGE_TERMINAL_PIN_LOCK_PATH = "/edge/v1/terminal-pin/lock";
var EDGE_CUSTOMERS_SEARCH_PATH = "/edge/v1/customers/search";
var EDGE_CUSTOMERS_PATH = "/edge/v1/customers";
var EDGE_BOOKING_DRAFTS_PATH = "/edge/v1/laundry/bookings/drafts";
var MAX_INTAKE_BODY_BYTES = 8 * 1024;
var EDGE_BOOKINGS_RECENT_PATH = "/edge/v1/laundry/bookings/recent";
var MAX_OPERATION_BODY_BYTES = 32 * 1024;
var INTAKE_SESSION_HEADER = "x-kitluy-session-id";
var CloudActivationUnavailableError = class extends Error {
  constructor() {
    super("the cloud activation authority is unreachable");
    this.name = "CloudActivationUnavailableError";
  }
};
function unavailableActivationGateway() {
  return {
    prepareActivation() {
      return Promise.reject(new CloudActivationUnavailableError());
    },
    completeActivation() {
      return Promise.reject(new CloudActivationUnavailableError());
    }
  };
}
var CANONICAL_ERROR = {
  // shared
  REQUEST_INVALID: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // route-level authorization
  TERMINAL_NOT_RECOGNIZED: "DEVICE_NOT_ASSIGNED",
  // terminal-health heartbeats (WS-11-T005-P02)
  HEARTBEAT_REPLAY_REJECTED: "RESOURCE_VERSION_CONFLICT",
  HEARTBEAT_BODY_TOO_LARGE: "VALIDATION_FAILED",
  CREDENTIAL_NOT_CURRENT: "DEVICE_NOT_ASSIGNED",
  ACTIVATION_REQUIRED: "DEVICE_NOT_ASSIGNED",
  SESSION_NOT_OWNED: "SCOPE_PERMISSION_DENIED",
  // pairing families (P03B closed vocabulary)
  PAIR_VERSION_INCOMPATIBLE: "VALIDATION_FAILED",
  PAIR_ASSIGNMENT_MISMATCH: "SCOPE_PERMISSION_DENIED",
  PAIR_CERT_INVALID: "SCOPE_PERMISSION_DENIED",
  PAIR_HUB_NOT_ACTIVE: "DEPENDENCY_UNAVAILABLE",
  PAIR_DEVICE_NOT_ELIGIBLE: "DEVICE_NOT_ASSIGNED",
  PAIR_PROFILE_FORBIDDEN: "PROFILE_NOT_ALLOWED",
  PAIR_CHALLENGE_FAILED: "SCOPE_PERMISSION_DENIED",
  PAIR_CHALLENGE_EXPIRED: "RESOURCE_VERSION_CONFLICT",
  PAIR_NONCE_REJECTED: "RESOURCE_VERSION_CONFLICT",
  PAIR_SESSION_OUTSTANDING: "RESOURCE_VERSION_CONFLICT",
  PAIR_SESSION_UNKNOWN: "RESOURCE_NOT_FOUND",
  PAIR_SESSION_CONSUMED: "RESOURCE_VERSION_CONFLICT",
  PAIR_PROOF_REQUIRED: "RESOURCE_VERSION_CONFLICT",
  PAIR_TRANSCRIPT_CONFLICT: "RESOURCE_VERSION_CONFLICT",
  RECEIPT_NOT_FOUND: "RESOURCE_NOT_FOUND",
  // activation families (cloud closed vocabulary, passed through the gateway)
  ACTIVATION_ACK_INVALID: "SCOPE_PERMISSION_DENIED",
  ACTIVATION_CHALLENGE_EXPIRED: "RESOURCE_VERSION_CONFLICT",
  ACTIVATION_CHALLENGE_CONSUMED: "RESOURCE_VERSION_CONFLICT",
  CREDENTIAL_INELIGIBLE: "SCOPE_PERMISSION_DENIED",
  REDEMPTION_REQUIRED: "RESOURCE_VERSION_CONFLICT",
  CHALLENGE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  HUB_INACTIVE: "SCOPE_PERMISSION_DENIED",
  ASSIGNMENT_INACTIVE: "SCOPE_PERMISSION_DENIED",
  ENROLLMENT_INELIGIBLE: "SCOPE_PERMISSION_DENIED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  PKI_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  CLOUD_UNAVAILABLE: "HUB_UNREACHABLE",
  // T1 runtime eligibility (WS-12-T001-P02 closed vocabulary)
  HUB_NOT_OPERATIONAL: "DEPENDENCY_UNAVAILABLE",
  HUB_RETIRED: "DEVICE_NOT_ASSIGNED",
  HUB_REPLACEMENT_BLOCKED: "DEPENDENCY_UNAVAILABLE",
  HUB_ASSIGNMENT_MISSING: "DEPENDENCY_UNAVAILABLE",
  ASSIGNMENT_SCOPE_MISMATCH: "SCOPE_PERMISSION_DENIED",
  ASSIGNMENT_GENERATION_STALE: "RESOURCE_VERSION_CONFLICT",
  PAIRING_REQUIRED: "DEVICE_NOT_ASSIGNED",
  PROFILE_NOT_GRANTED: "PROFILE_NOT_ALLOWED",
  PROFILE_NOT_T1: "PROFILE_NOT_ALLOWED",
  CONTAINMENT_PROHIBITS: "DEVICE_NOT_ASSIGNED",
  CONFIGURATION_MISSING: "DEPENDENCY_UNAVAILABLE",
  DELIVERY_SIGNER_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  // staff sessions (WS-12-T001-P02 closed vocabulary)
  STAFF_UNKNOWN: "AUTHENTICATION_REQUIRED",
  STAFF_DISABLED: "AUTHENTICATION_REQUIRED",
  STAFF_CREDENTIAL_INVALID: "AUTHENTICATION_REQUIRED",
  STAFF_SCOPE_MISMATCH: "SCOPE_PERMISSION_DENIED",
  // WS-12-T002 intake (closed vocabulary; scoped-missing merges with
  // cross-scope so no row-existence oracle exists).
  CUSTOMER_UNKNOWN: "RESOURCE_NOT_FOUND",
  DRAFT_UNKNOWN: "RESOURCE_NOT_FOUND",
  DRAFT_NOT_OPEN: "RESOURCE_VERSION_CONFLICT",
  DRAFT_VERSION_STALE: "RESOURCE_VERSION_CONFLICT",
  CUSTOMER_IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  CONSENT_IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  DRAFT_IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  REQUEST_INVALID_SHAPE: "VALIDATION_FAILED",
  PHONE_INVALID: "VALIDATION_FAILED",
  T1_NOT_AUTHORIZED: "SCOPE_PERMISSION_DENIED",
  STAFF_PROFILE_NOT_AUTHORIZED: "PROFILE_NOT_ALLOWED",
  SESSION_PERMISSION_DENIED: "SCOPE_PERMISSION_DENIED",
  SESSION_OCCUPIED: "RESOURCE_VERSION_CONFLICT",
  SESSION_UNKNOWN: "RESOURCE_NOT_FOUND",
  SESSION_EXPIRED: "AUTHENTICATION_REQUIRED",
  SESSION_CLOSED: "RESOURCE_VERSION_CONFLICT",
  // The Terminal PIN (closed vocabulary). A wrong PIN and a lock are distinct on
  // purpose: the PIN is the terminal's own, so there is no one to protect from
  // knowing how many tries are left, and the person at the counter must be told.
  PIN_FORMAT_INVALID: "VALIDATION_FAILED",
  PIN_CONFIRMATION_MISMATCH: "VALIDATION_FAILED",
  PIN_ALREADY_SET: "RESOURCE_VERSION_CONFLICT",
  PIN_SETUP_REQUIRED: "RESOURCE_VERSION_CONFLICT",
  PIN_INCORRECT: "AUTHENTICATION_REQUIRED",
  PIN_LOCKED: "RATE_LIMITED",
  TERMINAL_UNKNOWN: "DEVICE_NOT_ASSIGNED",
  // T1 Store operations (slice 2): what the Hub could not price or settle,
  // and the canonical command pipeline's own refusals (hub/errors.ts).
  CATALOG_NOT_DELIVERED: "DEPENDENCY_UNAVAILABLE",
  MONEY_CONTRACT_MISSING: "DEPENDENCY_UNAVAILABLE",
  NO_LINES: "VALIDATION_FAILED",
  SERVICE_UNKNOWN: "VALIDATION_FAILED",
  PRICING_MODE_MISMATCH: "VALIDATION_FAILED",
  QUANTITY_INVALID: "VALIDATION_FAILED",
  CURRENCY_MISMATCH: "DEPENDENCY_UNAVAILABLE",
  WEIGHT_RULE_MISSING: "DEPENDENCY_UNAVAILABLE",
  MONEY_ROUNDING_UNKNOWN: "DEPENDENCY_UNAVAILABLE",
  EXPRESS_NOT_CONFIGURED: "VALIDATION_FAILED",
  PRICE_MISMATCH: "RESOURCE_VERSION_CONFLICT",
  TENDER_INVALID: "VALIDATION_FAILED",
  FX_RATE_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  TENDER_INSUFFICIENT: "VALIDATION_FAILED",
  EDGE_IDEMPOTENCY_KEY_MALFORMED: "VALIDATION_FAILED",
  EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  EDGE_SEQUENCE_REPLAY_REJECTED: "RESOURCE_VERSION_CONFLICT",
  EDGE_SEQUENCE_GAP: "RESOURCE_VERSION_CONFLICT",
  EDGE_AGGREGATE_VERSION_CONFLICT: "RESOURCE_VERSION_CONFLICT",
  EDGE_SCOPE_MISMATCH: "SCOPE_PERMISSION_DENIED",
  EDGE_TERMINAL_UNKNOWN: "DEVICE_NOT_ASSIGNED",
  EDGE_DEVICE_CONTEXT_INVALID: "VALIDATION_FAILED",
  EDGE_DEVICE_NOT_ASSIGNED: "DEVICE_NOT_ASSIGNED",
  EDGE_DEVICE_REVOKED: "DEVICE_NOT_ASSIGNED",
  EDGE_ASSIGNMENT_GENERATION_MISMATCH: "RESOURCE_VERSION_CONFLICT",
  EDGE_SESSION_INVALID: "AUTHENTICATION_REQUIRED",
  EDGE_SESSION_EXPIRED: "AUTHENTICATION_REQUIRED",
  EDGE_PROFILE_NOT_AUTHORIZED: "PROFILE_NOT_ALLOWED",
  EDGE_PERMISSION_DENIED: "SCOPE_PERMISSION_DENIED",
  EDGE_PERMISSION_KEY_UNREGISTERED: "SCOPE_PERMISSION_DENIED",
  EDGE_RESOURCE_SCOPE_DENIED: "SCOPE_PERMISSION_DENIED",
  EDGE_ENVIRONMENT_DENIED: "SCOPE_PERMISSION_DENIED",
  EDGE_APPROVAL_REQUIRED: "SCOPE_PERMISSION_DENIED",
  EDGE_SELF_APPROVAL_FORBIDDEN: "SCOPE_PERMISSION_DENIED",
  EDGE_AGGREGATE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  EDGE_INVALID_TRANSITION: "RESOURCE_VERSION_CONFLICT",
  EDGE_PAYMENT_GATE_BLOCKED: "RESOURCE_VERSION_CONFLICT",
  EDGE_CUSTODY_GATE_BLOCKED: "RESOURCE_VERSION_CONFLICT",
  EDGE_CONFIGURATION_MISSING: "DEPENDENCY_UNAVAILABLE",
  EDGE_REQUIRED_VALUE_MISSING: "VALIDATION_FAILED",
  EDGE_COMMAND_UNKNOWN: "INTERNAL_ERROR",
  EDGE_COMMAND_INACTIVE: "SCOPE_PERMISSION_DENIED"
};
var CANONICAL_MESSAGE = {
  VALIDATION_FAILED: "the request is invalid",
  AUTHENTICATION_REQUIRED: "staff authentication is required or the session is not usable",
  DEVICE_NOT_ASSIGNED: "the authenticated terminal is not eligible for this capability",
  PROFILE_NOT_ALLOWED: "the requested terminal profile is not granted",
  SCOPE_PERMISSION_DENIED: "the presented authority was refused",
  RESOURCE_VERSION_CONFLICT: "the flow has moved past this request",
  RESOURCE_NOT_FOUND: "no such resource",
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST: "the idempotency key was already used with a different request",
  DEPENDENCY_UNAVAILABLE: "a required authority is unavailable",
  HUB_UNREACHABLE: "the cloud activation authority is unreachable; retry later",
  RATE_LIMITED: "too many attempts; wait until the lock ends",
  INTERNAL_ERROR: "the operation failed and the details are not disclosed"
};
function refusal(result, correlationId) {
  const code = CANONICAL_ERROR[result] ?? "INTERNAL_ERROR";
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, CANONICAL_MESSAGE[code] ?? "the request was refused", {
      correlationId,
      details: { result, retryable: isRetryable(code) }
    })
  };
}
function pinRefusal(outcome, correlationId) {
  if (outcome.outcome !== "refused") return refusal("INTERNAL_ERROR", correlationId);
  const code = CANONICAL_ERROR[outcome.refusal] ?? "INTERNAL_ERROR";
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, CANONICAL_MESSAGE[code] ?? "the request was refused", {
      correlationId,
      details: {
        result: outcome.refusal,
        retryable: isRetryable(code),
        ...outcome.status === void 0 ? {} : { pin: outcome.status }
      }
    })
  };
}
function invalid(correlationId, detail, fields = []) {
  return {
    status: httpStatusFor("VALIDATION_FAILED"),
    body: errorEnvelope("VALIDATION_FAILED", detail, {
      correlationId,
      details: {
        result: "REQUEST_INVALID",
        retryable: false,
        ...fields.length > 0 ? { fields: fields.slice(0, 16) } : {}
      }
    })
  };
}
function parseBody(rawBody) {
  if (rawBody === "") return {};
  try {
    const parsed = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function contentTypeIsJson(headers, method) {
  if (method === "GET") return true;
  const raw = headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && /^application\/json\s*(;.*)?$/i.test(value.trim());
}
function unknownFields(body, allowed) {
  return Object.keys(body).filter((key) => !allowed.includes(key)).map((key) => key.slice(0, 64));
}
function requireShaped(body, key, shape) {
  const value = body[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return shape.test(trimmed) ? trimmed : null;
}
function idempotencyKeyFrom(headers) {
  const raw = headers["idempotency-key"];
  const values = (Array.isArray(raw) ? raw : raw === void 0 ? [] : [raw]).map((v) => v.trim());
  if (values.length === 0 || new Set(values).size > 1) return null;
  const key = values[0] ?? "";
  return IDEMPOTENCY_KEY.test(key) ? key : null;
}
function base64UrlToBase64(value) {
  const translated = value.replace(/-/g, "+").replace(/_/g, "/");
  return translated + "=".repeat((4 - translated.length % 4) % 4);
}
function base64ToBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function authorizePeer(pool, certificateSerial) {
  const rows = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query(
        `select t.id, t.lifecycle_status, c.status as cred_status,
                (c.revoked_at is not null) as revoked,
                (c.expires_at <= now()) as expired
           from edge_identity.terminal_device t
           join edge_identity.device_credential c
             on c.certificate_serial = t.certificate_serial
          where t.certificate_serial = $1`,
        [certificateSerial]
      );
      return result.rows;
    },
    HUB_RUNTIME_ROLE
  );
  const row = rows[0];
  if (row === void 0) return { ok: false, result: "TERMINAL_NOT_RECOGNIZED" };
  if (row.lifecycle_status === "revoked" || row.lifecycle_status === "retired") {
    return { ok: false, result: "TERMINAL_NOT_RECOGNIZED" };
  }
  if (row.cred_status !== "active" || row.revoked || row.expired) {
    return { ok: false, result: "CREDENTIAL_NOT_CURRENT" };
  }
  return {
    ok: true,
    terminal: {
      terminalDeviceId: row.id,
      certificateSerial,
      lifecycleStatus: row.lifecycle_status,
      activated: row.lifecycle_status === "active"
    }
  };
}
async function sessionOwnedBy(pool, sessionId, terminalDeviceId) {
  const rows = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query(
        `select terminal_device_id from edge_identity.pairing_session where id = $1::uuid`,
        [sessionId]
      );
      return result.rows;
    },
    HUB_RUNTIME_ROLE
  );
  const row = rows[0];
  if (row === void 0) return "unknown";
  return row.terminal_device_id === terminalDeviceId ? "owned" : "foreign";
}
var NO_LOG3 = { info: () => void 0 };
var PAIRING_CHALLENGE_LIFETIME_SECONDS = 300;
function matchRoute(method, path) {
  const clean = path.split("?")[0]?.replace(/\/+$/, "") ?? "";
  if (clean === WELL_KNOWN_DISCOVERY_PATH) {
    return method === "GET" ? { route: "discovery" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_ACTIVATION_CHALLENGES_PATH) {
    return method === "POST" ? { route: "activation-challenges" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_ACTIVATION_COMPLETE_PATH) {
    return method === "POST" ? { route: "activation-complete" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_PAIRING_SESSIONS_PATH) {
    return method === "POST" ? { route: "pairing-sessions" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_HEALTH_HEARTBEATS_PATH) {
    return method === "POST" ? { route: "terminal-health-heartbeats" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_RUNTIME_AUTHORITY_TIME_PATH) {
    return method === "GET" ? { route: "runtime-authority-time" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_RUNTIME_ELIGIBILITY_PATH) {
    return method === "GET" ? { route: "runtime-eligibility" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_CONFIGURATION_CURRENT_PATH) {
    return method === "GET" ? { route: "configuration-current" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_SESSIONS_OPEN_PATH) {
    return method === "POST" ? { route: "sessions-open" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_SESSIONS_REFRESH_PATH) {
    return method === "POST" ? { route: "sessions-refresh" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_SESSIONS_CLOSE_PATH) {
    return method === "POST" ? { route: "sessions-close" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_PIN_STATUS_PATH) {
    return method === "GET" ? { route: "terminal-pin-status" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_PIN_SETUP_PATH) {
    return method === "POST" ? { route: "terminal-pin-setup" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_PIN_UNLOCK_PATH) {
    return method === "POST" ? { route: "terminal-pin-unlock" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_PIN_CHANGE_PATH) {
    return method === "POST" ? { route: "terminal-pin-change" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_PIN_LOCK_PATH) {
    return method === "POST" ? { route: "terminal-pin-lock" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_CUSTOMERS_SEARCH_PATH) {
    return method === "GET" ? { route: "customers-search" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_CUSTOMERS_PATH) {
    return method === "POST" ? { route: "customers-create" } : "METHOD_NOT_ALLOWED";
  }
  const customer = /^\/edge\/v1\/customers\/([^/]+)(?:\/(consent-decisions))?$/.exec(clean);
  if (customer !== null) {
    const customerId = customer[1] ?? "";
    if (!UUID3.test(customerId)) return null;
    if (customer[2] === "consent-decisions") {
      return method === "POST" ? { route: "customers-consent", customerId } : "METHOD_NOT_ALLOWED";
    }
    return method === "GET" ? { route: "customers-read", customerId } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_BOOKING_DRAFTS_PATH) {
    return method === "POST" ? { route: "drafts-create" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_BOOKINGS_RECENT_PATH) {
    return method === "GET" ? { route: "bookings-recent" } : "METHOD_NOT_ALLOWED";
  }
  const draft = /^\/edge\/v1\/laundry\/bookings\/drafts\/([^/]+)(?:\/(cancel|quote))?$/.exec(clean);
  if (draft !== null) {
    const draftId = draft[1] ?? "";
    if (!UUID3.test(draftId)) return null;
    if (draft[2] === "cancel") {
      return method === "POST" ? { route: "drafts-cancel", draftId } : "METHOD_NOT_ALLOWED";
    }
    if (draft[2] === "quote") {
      return method === "POST" ? { route: "drafts-quote", draftId } : "METHOD_NOT_ALLOWED";
    }
    if (method === "GET") return { route: "drafts-read", draftId };
    if (method === "PATCH") return { route: "drafts-update", draftId };
    return "METHOD_NOT_ALLOWED";
  }
  const confirm = /^\/edge\/v1\/laundry\/bookings\/([^/]+)\/confirm-intake$/.exec(clean);
  if (confirm !== null) {
    const draftId = confirm[1] ?? "";
    if (!UUID3.test(draftId)) return null;
    return method === "POST" ? { route: "bookings-confirm", draftId } : "METHOD_NOT_ALLOWED";
  }
  const sub = /^\/edge\/v1\/terminal-pairing\/sessions\/([^/]+)\/(terminal-proof|complete|receipt)$/.exec(
    clean
  );
  if (sub !== null) {
    const sessionId = sub[1] ?? "";
    if (!UUID3.test(sessionId)) return null;
    const tail = sub[2];
    if (tail === "terminal-proof") {
      return method === "POST" ? { route: "pairing-proof", sessionId } : "METHOD_NOT_ALLOWED";
    }
    if (tail === "complete") {
      return method === "POST" ? { route: "pairing-complete", sessionId } : "METHOD_NOT_ALLOWED";
    }
    return method === "GET" ? { route: "pairing-receipt", sessionId } : "METHOD_NOT_ALLOWED";
  }
  return null;
}
function createEdgeTerminalRouter(deps) {
  const logger = deps.logger ?? NO_LOG3;
  function log2(operation, correlationId, status, result) {
    logger.info({ operation, correlationId, status, result });
  }
  return {
    async handle(request) {
      const correlationId = randomUUID8();
      const finish = (operation2, response, result) => {
        log2(operation2, correlationId, response.status, result);
        return response;
      };
      const matched = matchRoute(request.method, request.path);
      if (matched === null) {
        return finish(
          "edge:unmatched",
          {
            status: httpStatusFor("RESOURCE_NOT_FOUND"),
            body: errorEnvelope("RESOURCE_NOT_FOUND", "no such route", { correlationId })
          },
          "RESOURCE_NOT_FOUND"
        );
      }
      if (matched === "METHOD_NOT_ALLOWED") {
        return finish(
          "edge:unmatched",
          {
            status: 405,
            body: errorEnvelope("VALIDATION_FAILED", "method not allowed", { correlationId })
          },
          "METHOD_NOT_ALLOWED"
        );
      }
      const operation = `edge:${matched.route}`;
      if (matched.route === "discovery") {
        return finish(
          operation,
          { status: 200, body: deps.discovery.wellKnownPayload() },
          "SIGNED_RECORD"
        );
      }
      if (!contentTypeIsJson(request.headers, request.method)) {
        return finish(
          operation,
          invalid(correlationId, "Content-Type must be application/json"),
          "REQUEST_INVALID"
        );
      }
      const body = parseBody(request.rawBody);
      if (body === null) {
        return finish(
          operation,
          invalid(correlationId, "a JSON object body is required"),
          "REQUEST_INVALID"
        );
      }
      const gate = await authorizePeer(deps.pool, request.peer.certificateSerial);
      if (!gate.ok) {
        return finish(operation, refusal(gate.result, correlationId), gate.result);
      }
      const terminal = gate.terminal;
      const queryString = request.path.split("?")[1] ?? "";
      const environment = deps.environment ?? "development";
      const QUERYLESS_ROUTES = [
        "runtime-authority-time",
        "runtime-eligibility",
        "configuration-current",
        "sessions-open",
        "sessions-refresh",
        "sessions-close",
        "terminal-pin-status",
        "terminal-pin-setup",
        "terminal-pin-unlock",
        "terminal-pin-change",
        "terminal-pin-lock",
        // T002: every intake route refuses query strings EXCEPT the search
        // read, whose single bounded `phone` parameter is parsed explicitly.
        "customers-create",
        "customers-read",
        "customers-consent",
        "drafts-create",
        "drafts-read",
        "drafts-update",
        "drafts-cancel",
        "drafts-quote",
        "bookings-confirm",
        "bookings-recent"
      ];
      if (QUERYLESS_ROUTES.includes(matched.route) && queryString !== "") {
        return finish(
          operation,
          invalid(correlationId, "query parameters are not accepted"),
          "REQUEST_INVALID"
        );
      }
      try {
        switch (matched.route) {
          case "runtime-authority-time": {
            const payload = await readAuthorityTime(deps.pool);
            return finish(
              operation,
              { status: 200, body: { result: "AUTHORITY_TIME", correlationId, ...payload } },
              "AUTHORITY_TIME"
            );
          }
          case "runtime-eligibility": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED"
              );
            }
            const eligibility = await readRuntimeEligibility(
              deps.pool,
              terminal.terminalDeviceId,
              terminal.certificateSerial,
              environment
            );
            if (eligibility.outcome === "refused") {
              return finish(
                operation,
                refusal(eligibility.refusal, correlationId),
                eligibility.refusal
              );
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: "ELIGIBLE", correlationId, eligibility: eligibility.payload }
              },
              "ELIGIBLE"
            );
          }
          case "configuration-current": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED"
              );
            }
            if (deps.deliverySigner === void 0) {
              return finish(
                operation,
                refusal("DELIVERY_SIGNER_UNAVAILABLE", correlationId),
                "DELIVERY_SIGNER_UNAVAILABLE"
              );
            }
            const delivery = await readCurrentConfigurationDelivery(
              deps.pool,
              terminal.terminalDeviceId,
              terminal.certificateSerial,
              environment,
              deps.deliverySigner,
              correlationId
            );
            if (delivery.outcome === "refused") {
              return finish(operation, refusal(delivery.refusal, correlationId), delivery.refusal);
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: "CONFIGURATION_DELIVERY", correlationId, ...delivery.body }
              },
              "CONFIGURATION_DELIVERY"
            );
          }
          case "sessions-open": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED"
              );
            }
            const idempotencyKey = idempotencyKeyFrom(request.headers);
            if (idempotencyKey === null) {
              return finish(
                operation,
                invalid(correlationId, "an Idempotency-Key header is required"),
                "REQUEST_INVALID"
              );
            }
            const unknown = unknownFields(body, ["actorId", "passcode", "profileCode"]);
            if (unknown.length > 0) {
              return finish(
                operation,
                invalid(correlationId, "unknown fields", unknown),
                "REQUEST_INVALID"
              );
            }
            const actorId = requireShaped(body, "actorId", UUID3);
            const profileCode = requireShaped(body, "profileCode", PROFILE2);
            const passcode = typeof body["passcode"] === "string" ? body["passcode"] : null;
            if (actorId === null || profileCode === null || passcode === null || passcode.length < 4 || passcode.length > 128) {
              return finish(
                operation,
                invalid(
                  correlationId,
                  "actorId, passcode and profileCode are required and bounded"
                ),
                "REQUEST_INVALID"
              );
            }
            const gateResult = await readRuntimeEligibility(
              deps.pool,
              terminal.terminalDeviceId,
              terminal.certificateSerial,
              environment
            );
            if (gateResult.outcome === "refused") {
              return finish(
                operation,
                refusal(gateResult.refusal, correlationId),
                gateResult.refusal
              );
            }
            const opened = await openStaffSession(deps.pool, {
              terminalDeviceId: terminal.terminalDeviceId,
              actorId,
              passcode,
              profileCode
            });
            if (opened.outcome === "refused") {
              return finish(operation, refusal(opened.refusal, correlationId), opened.refusal);
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: opened.result, correlationId, session: opened.session }
              },
              opened.result
            );
          }
          case "sessions-refresh":
          case "sessions-close": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED"
              );
            }
            const idempotencyKey = idempotencyKeyFrom(request.headers);
            if (idempotencyKey === null) {
              return finish(
                operation,
                invalid(correlationId, "an Idempotency-Key header is required"),
                "REQUEST_INVALID"
              );
            }
            const unknown = unknownFields(body, ["sessionId"]);
            if (unknown.length > 0) {
              return finish(
                operation,
                invalid(correlationId, "unknown fields", unknown),
                "REQUEST_INVALID"
              );
            }
            const sessionId = requireShaped(body, "sessionId", UUID3);
            if (sessionId === null) {
              return finish(
                operation,
                invalid(correlationId, "sessionId is required"),
                "REQUEST_INVALID"
              );
            }
            const action = matched.route === "sessions-refresh" ? refreshStaffSession : closeStaffSession;
            const outcome = await action(deps.pool, {
              terminalDeviceId: terminal.terminalDeviceId,
              sessionId
            });
            if (outcome.outcome === "refused") {
              return finish(operation, refusal(outcome.refusal, correlationId), outcome.refusal);
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: outcome.result, correlationId, session: outcome.session }
              },
              outcome.result
            );
          }
          case "terminal-pin-status":
          case "terminal-pin-setup":
          case "terminal-pin-unlock":
          case "terminal-pin-change":
          case "terminal-pin-lock":
            return finish(
              operation,
              await handleTerminalPin(deps, terminal, matched.route, request, body, correlationId),
              "HANDLED"
            );
          case "customers-search":
          case "customers-read":
          case "customers-create":
          case "customers-consent":
          case "drafts-create":
          case "drafts-read":
          case "drafts-update":
          case "drafts-cancel":
            return finish(
              operation,
              await handleT1Intake(
                deps,
                terminal,
                matched,
                request,
                body,
                queryString,
                correlationId
              ),
              "HANDLED"
            );
          case "drafts-quote":
          case "bookings-confirm":
          case "bookings-recent":
            return finish(
              operation,
              await handleT1Operations(deps, terminal, matched, request, body, correlationId),
              "HANDLED"
            );
          case "activation-challenges":
            return finish(
              operation,
              await handleActivationChallenges(deps, body, correlationId),
              "HANDLED"
            );
          case "activation-complete":
            return finish(
              operation,
              await handleActivationComplete(deps, request, body, correlationId),
              "HANDLED"
            );
          case "terminal-health-heartbeats":
            return finish(
              operation,
              await handleTerminalHealthHeartbeat(deps, terminal, request, body, correlationId),
              "HANDLED"
            );
          case "pairing-sessions": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED"
              );
            }
            return finish(
              operation,
              await handlePairingSessions(deps, terminal, body, correlationId),
              "HANDLED"
            );
          }
          case "pairing-proof":
          case "pairing-complete":
          case "pairing-receipt": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED"
              );
            }
            const ownership = await sessionOwnedBy(
              deps.pool,
              matched.sessionId,
              terminal.terminalDeviceId
            );
            if (ownership === "unknown") {
              return finish(
                operation,
                refusal("PAIR_SESSION_UNKNOWN", correlationId),
                "PAIR_SESSION_UNKNOWN"
              );
            }
            if (ownership === "foreign") {
              return finish(
                operation,
                refusal("SESSION_NOT_OWNED", correlationId),
                "SESSION_NOT_OWNED"
              );
            }
            if (matched.route === "pairing-proof") {
              return finish(
                operation,
                await handlePairingProof(deps, matched.sessionId, body, correlationId),
                "HANDLED"
              );
            }
            if (matched.route === "pairing-complete") {
              return finish(
                operation,
                await handlePairingComplete(deps, matched.sessionId, body, correlationId),
                "HANDLED"
              );
            }
            return finish(
              operation,
              await handlePairingReceipt(deps, matched.sessionId, correlationId),
              "HANDLED"
            );
          }
        }
      } catch (error) {
        if (error instanceof CloudActivationUnavailableError) {
          return finish(
            operation,
            refusal("CLOUD_UNAVAILABLE", correlationId),
            "CLOUD_UNAVAILABLE"
          );
        }
        return finish(operation, refusal("INTERNAL_ERROR", correlationId), "INTERNAL_ERROR");
      }
    }
  };
}
var ACTIVATION_CHALLENGE_FIELDS = ["terminalAssignmentId", "redemptionIdempotencyKey"];
async function handleActivationChallenges(deps, body, correlationId) {
  const unknown = unknownFields(body, ACTIVATION_CHALLENGE_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const terminalAssignmentId = requireShaped(body, "terminalAssignmentId", UUID3);
  const redemptionIdempotencyKey = requireShaped(body, "redemptionIdempotencyKey", IDEMPOTENCY_KEY);
  const missing = [
    ...terminalAssignmentId === null ? ["terminalAssignmentId"] : [],
    ...redemptionIdempotencyKey === null ? ["redemptionIdempotencyKey"] : []
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.activationGateway.prepareActivation({
    terminalAssignmentId,
    redemptionIdempotencyKey
  });
  if (outcome.result === "ALREADY_ACTIVATED") {
    return { status: 200, body: { result: "ALREADY_ACTIVATED", correlationId } };
  }
  if (outcome.result !== "ACTIVATION_PREPARED" || outcome.data === void 0) {
    return refusal(outcome.result, correlationId);
  }
  const challenge = outcome.data;
  return {
    status: 201,
    body: {
      result: "ACTIVATION_PREPARED",
      correlationId,
      challenge: {
        activationChallengeId: challenge.activationChallengeId,
        protocolVersion: challenge.challengeVersion,
        signatureAlgorithm: challenge.signatureAlgorithm,
        signingPayloadEncoding: challenge.signingPayloadEncoding,
        signingPayload: challenge.signingPayload,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        certificateId: challenge.certificateId,
        certificateSerial: challenge.certificateSerial,
        certificateFingerprint: challenge.certificateFingerprint,
        terminalProfileKey: challenge.terminalProfileKey
      }
    }
  };
}
var ACTIVATION_COMPLETE_FIELDS = [
  "activationChallengeId",
  "protocolVersion",
  "signature",
  "terminalPublicKeyPem"
];
var ACTIVATION_PROTOCOL_VERSION = "kitluy.activation-ack.v1";
async function handleActivationComplete(deps, request, body, correlationId) {
  const unknown = unknownFields(body, ACTIVATION_COMPLETE_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  if (body["protocolVersion"] !== ACTIVATION_PROTOCOL_VERSION) {
    return invalid(correlationId, "unsupported activation protocol version", ["protocolVersion"]);
  }
  const activationChallengeId = requireShaped(body, "activationChallengeId", UUID3);
  const signature = requireShaped(body, "signature", SIGNATURE_B64URL);
  const pemRaw = body["terminalPublicKeyPem"];
  const terminalPublicKeyPem = typeof pemRaw === "string" && pemRaw.length <= MAX_PEM_CHARS && pemRaw.includes("BEGIN PUBLIC KEY") && pemRaw.includes("END PUBLIC KEY") ? pemRaw : null;
  const idempotencyKey = idempotencyKeyFrom(request.headers);
  const missing = [
    ...activationChallengeId === null ? ["activationChallengeId"] : [],
    ...signature === null ? ["signature"] : [],
    ...terminalPublicKeyPem === null ? ["terminalPublicKeyPem"] : [],
    ...idempotencyKey === null ? ["idempotency-key"] : []
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.activationGateway.completeActivation({
    activationChallengeId,
    signatureBase64: base64UrlToBase64(signature),
    terminalPublicKeyPem,
    idempotencyKey
  });
  if ((outcome.result === "ACTIVATED" || outcome.result === "ALREADY_ACTIVATED") && outcome.data !== void 0) {
    return {
      status: 200,
      body: {
        result: outcome.result,
        correlationId,
        activation: {
          activationId: outcome.data.activationId,
          certificateId: outcome.data.certificateId,
          acknowledgedAt: outcome.data.acknowledgedAt,
          activatedAt: outcome.data.activatedAt
        }
      }
    };
  }
  return refusal(outcome.result, correlationId);
}
var PAIRING_SESSION_FIELDS = [
  "requestedProfileCode",
  "terminalNonce",
  "protocolVersion",
  "environment"
];
function transcriptFromChallenge(c) {
  return {
    pairingSessionId: c.pairingSessionId,
    protocolVersion: c.protocolVersion,
    purpose: c.purpose,
    tenantId: c.tenantId,
    digitalStoreId: c.digitalStoreId,
    storeLocationId: c.storeLocationId,
    environment: c.environment,
    hubDeviceId: c.hubDeviceId,
    hubAssignmentGeneration: c.hubAssignmentGeneration,
    hubCertificateSerial: c.hubCertificateSerial,
    hubCertificateFingerprint: c.hubCertificateFingerprint,
    terminalDeviceId: c.terminalDeviceId,
    terminalAssignmentGeneration: c.terminalAssignmentGeneration,
    terminalProfileKey: c.terminalProfileKey,
    terminalCertificateSerial: c.terminalCertificateSerial,
    terminalCertificateFingerprint: c.terminalCertificateFingerprint,
    terminalNonce: c.terminalNonce,
    hubNonce: c.hubNonce,
    issuedAt: new Date(c.issuedAt),
    expiresAt: new Date(c.expiresAt)
  };
}
async function handlePairingSessions(deps, terminal, body, correlationId) {
  const unknown = unknownFields(body, PAIRING_SESSION_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const requestedProfileCode = requireShaped(body, "requestedProfileCode", PROFILE2);
  const terminalNonce = requireShaped(body, "terminalNonce", HEX643);
  const protocolVersion = requireShaped(body, "protocolVersion", /^[0-9.]{1,16}$/);
  const environment = requireShaped(body, "environment", /^(development|pilot|production)$/);
  const missing = [
    ...requestedProfileCode === null ? ["requestedProfileCode"] : [],
    ...terminalNonce === null ? ["terminalNonce"] : [],
    ...protocolVersion === null ? ["protocolVersion"] : [],
    ...environment === null ? ["environment"] : []
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.pairing.preparePairing({
    // THE AUTHENTICATED TERMINAL — never a body field. A terminal pairs as
    // the device its certificate proves, or not at all.
    terminalDeviceId: terminal.terminalDeviceId,
    requestedProfileCode,
    terminalNonce,
    protocolVersion,
    environment,
    // The locked lifetime. The 0032 door clamps to 300 s of HUB-authoritative
    // time regardless of this process's clock — no skew grace.
    expiresAt: new Date(Date.now() + PAIRING_CHALLENGE_LIFETIME_SECONDS * 1e3)
  });
  if (outcome.result !== "PAIRING_PREPARED" || outcome.data === void 0) {
    return refusal(outcome.result, correlationId);
  }
  const challenge = outcome.data;
  const signingPayload = Buffer.from(
    terminalPairingProofBytes(transcriptFromChallenge(challenge))
  ).toString("base64url");
  return {
    status: 201,
    body: {
      result: "PAIRING_PREPARED",
      correlationId,
      session: {
        ...challenge,
        signatureAlgorithm: "ed25519",
        signingPayloadEncoding: "base64url",
        signingPayload
      }
    }
  };
}
var PAIRING_PROOF_FIELDS = ["signature", "terminalPublicKeyPem"];
async function handlePairingProof(deps, sessionId, body, correlationId) {
  const unknown = unknownFields(body, PAIRING_PROOF_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const signature = requireShaped(body, "signature", SIGNATURE_B64URL);
  const pemRaw = body["terminalPublicKeyPem"];
  const terminalPublicKeyPem = typeof pemRaw === "string" && pemRaw.length <= MAX_PEM_CHARS && pemRaw.includes("BEGIN PUBLIC KEY") && pemRaw.includes("END PUBLIC KEY") ? pemRaw : null;
  const missing = [
    ...signature === null ? ["signature"] : [],
    ...terminalPublicKeyPem === null ? ["terminalPublicKeyPem"] : []
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.pairing.verifyTerminalProofAndRecord({
    pairingSessionId: sessionId,
    signatureBase64: base64UrlToBase64(signature),
    terminalPublicKeyPem
  });
  if (outcome.result !== "TERMINAL_PROOF_RECORDED" || outcome.data === void 0) {
    return refusal(outcome.result, correlationId);
  }
  return {
    status: 200,
    body: {
      result: "TERMINAL_PROOF_RECORDED",
      correlationId,
      transcriptHash: outcome.data.transcriptHash
    }
  };
}
async function handlePairingComplete(deps, sessionId, body, correlationId) {
  const unknown = unknownFields(body, []);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const outcome = await deps.pairing.produceHubProofAndComplete({ pairingSessionId: sessionId });
  if (outcome.result !== "PAIRED" && outcome.result !== "ALREADY_PAIRED" || outcome.data === void 0) {
    return refusal(outcome.result, correlationId);
  }
  const state = outcome.data;
  return {
    status: 200,
    body: {
      result: outcome.result,
      correlationId,
      pairing: {
        pairingSessionId: state.pairingSessionId,
        receiptId: state.receiptId,
        transcriptHash: state.transcriptHash,
        receipt: {
          ...state.receipt,
          pairedAt: state.receipt.pairedAt.toISOString(),
          validUntil: state.receipt.validUntil?.toISOString() ?? null
        },
        receiptSignature: base64ToBase64Url(state.receiptSignatureBase64),
        hubProofSignature: base64ToBase64Url(state.hubProofSignatureBase64),
        pairedAt: state.pairedAt
      }
    }
  };
}
async function handlePairingReceipt(deps, sessionId, correlationId) {
  const outcome = await deps.pairing.reconcilePairingReceipt({ pairingSessionId: sessionId });
  if (outcome.result !== "RECEIPT_FOUND" || outcome.data === void 0) {
    return refusal(outcome.result, correlationId);
  }
  const state = outcome.data;
  return {
    status: 200,
    body: {
      result: "RECEIPT_FOUND",
      correlationId,
      pairing: {
        pairingSessionId: state.pairingSessionId,
        receiptId: state.receiptId,
        transcriptHash: state.transcriptHash,
        receipt: {
          ...state.receipt,
          pairedAt: state.receipt.pairedAt.toISOString(),
          validUntil: state.receipt.validUntil?.toISOString() ?? null
        },
        receiptSignature: base64ToBase64Url(state.receiptSignatureBase64),
        pairedAt: state.pairedAt
      }
    }
  };
}
var HEARTBEAT_ALLOWED_FIELDS = [
  "heartbeatSequence",
  "uptimeSeconds",
  "applicationVersion",
  "releaseVersion",
  "configSnapshotVersion",
  "queueDepth",
  "localDatabaseAvailable",
  "peripheralSummary",
  "diskFreeBytes",
  "observedAt",
  "reasonCodes"
];
var PERIPHERAL_STATES = /* @__PURE__ */ new Set([
  "unknown",
  "ready",
  "busy",
  "degraded",
  "disconnected",
  "misconfigured",
  "unsupported",
  "maintenance_required"
]);
var VERSION_TEXT = /^[A-Za-z0-9_.:+-]{1,64}$/;
var REASON_CODE = /^[a-z0-9_]{1,48}$/;
function boundedInt(value, min, max) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}
async function handleTerminalHealthHeartbeat(deps, terminal, request, body, correlationId) {
  if (Buffer.byteLength(request.rawBody, "utf8") > MAX_HEARTBEAT_BODY_BYTES) {
    return refusal("HEARTBEAT_BODY_TOO_LARGE", correlationId);
  }
  const unknown = unknownFields(body, HEARTBEAT_ALLOWED_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown heartbeat fields are refused", unknown);
  }
  const heartbeatSequence = boundedInt(body["heartbeatSequence"], 1, Number.MAX_SAFE_INTEGER);
  const uptimeSeconds = boundedInt(body["uptimeSeconds"], 0, Number.MAX_SAFE_INTEGER);
  const configSnapshotVersion = boundedInt(
    body["configSnapshotVersion"],
    0,
    Number.MAX_SAFE_INTEGER
  );
  const applicationVersion = body["applicationVersion"];
  if (heartbeatSequence === null || uptimeSeconds === null || configSnapshotVersion === null || typeof applicationVersion !== "string" || !VERSION_TEXT.test(applicationVersion)) {
    return invalid(
      correlationId,
      "heartbeatSequence, uptimeSeconds, configSnapshotVersion and applicationVersion are required and bounded"
    );
  }
  const releaseVersion = body["releaseVersion"];
  if (releaseVersion !== void 0 && (typeof releaseVersion !== "string" || !VERSION_TEXT.test(releaseVersion))) {
    return invalid(correlationId, "releaseVersion is bounded text");
  }
  const queueDepth = body["queueDepth"] === void 0 ? void 0 : boundedInt(body["queueDepth"], 0, 1e6);
  if (body["queueDepth"] !== void 0 && queueDepth === null) {
    return invalid(correlationId, "queueDepth is a bounded integer");
  }
  const diskFreeBytes = body["diskFreeBytes"] === void 0 ? void 0 : boundedInt(body["diskFreeBytes"], 0, Number.MAX_SAFE_INTEGER);
  if (body["diskFreeBytes"] !== void 0 && diskFreeBytes === null) {
    return invalid(correlationId, "diskFreeBytes is a bounded integer");
  }
  const localDatabaseAvailable = body["localDatabaseAvailable"];
  if (localDatabaseAvailable !== void 0 && typeof localDatabaseAvailable !== "boolean") {
    return invalid(correlationId, "localDatabaseAvailable is a boolean");
  }
  const peripheralSummary = body["peripheralSummary"];
  if (peripheralSummary !== void 0 && (typeof peripheralSummary !== "string" || !PERIPHERAL_STATES.has(peripheralSummary))) {
    return invalid(
      correlationId,
      "peripheralSummary is one of the eight canonical peripheral states"
    );
  }
  const observedAt = body["observedAt"];
  if (observedAt !== void 0 && (typeof observedAt !== "string" || observedAt.length > 40 || Number.isNaN(Date.parse(observedAt)))) {
    return invalid(correlationId, "observedAt is an ISO timestamp (diagnostic only)");
  }
  const reasonCodes = body["reasonCodes"];
  if (reasonCodes !== void 0 && (!Array.isArray(reasonCodes) || reasonCodes.length > 8 || reasonCodes.some((code) => typeof code !== "string" || !REASON_CODE.test(code)))) {
    return invalid(correlationId, "reasonCodes is a bounded array of short codes");
  }
  const heartbeat = {
    heartbeatSequence,
    uptimeSeconds,
    applicationVersion,
    configSnapshotVersion,
    ...releaseVersion !== void 0 ? { releaseVersion } : {},
    ...queueDepth !== void 0 && queueDepth !== null ? { queueDepth } : {},
    ...localDatabaseAvailable !== void 0 ? { localDatabaseAvailable } : {},
    ...peripheralSummary !== void 0 ? { peripheralSummary } : {},
    ...diskFreeBytes !== void 0 && diskFreeBytes !== null ? { diskFreeBytes } : {},
    ...observedAt !== void 0 ? { observedAt } : {},
    ...reasonCodes !== void 0 ? { reasonCodes } : {}
  };
  const outcome = await acceptTerminalHeartbeat(
    deps.pool,
    terminal.terminalDeviceId,
    heartbeat,
    deps.environment ?? "development",
    deps.logger
  );
  if (outcome.result === "HEARTBEAT_REPLAY_REJECTED") {
    return refusal("HEARTBEAT_REPLAY_REJECTED", correlationId);
  }
  return {
    status: 200,
    body: { result: outcome.result, correlationId, heartbeat: outcome }
  };
}
var INTAKE_ROUTE_PERMISSION = {
  "customers-search": PERMISSION_CUSTOMERS_READ,
  "customers-read": PERMISSION_CUSTOMERS_READ,
  "customers-create": PERMISSION_CUSTOMERS_CREATE,
  "customers-consent": PERMISSION_CONSENT_RECORD,
  "drafts-read": PERMISSION_BOOKINGS_READ,
  "drafts-create": PERMISSION_BOOKINGS_CREATE,
  "drafts-update": PERMISSION_BOOKINGS_CREATE,
  "drafts-cancel": PERMISSION_BOOKINGS_CREATE
};
var INTAKE_MUTATIONS = [
  "customers-create",
  "customers-consent",
  "drafts-create",
  "drafts-update",
  "drafts-cancel"
];
var NOTES_MAX = 2e3;
var NAME_MAX = 200;
var PIN_BODY_FIELDS = {
  "terminal-pin-setup": ["pin", "pinConfirmation"],
  "terminal-pin-unlock": ["pin"],
  "terminal-pin-change": ["currentPin", "newPin", "newPinConfirmation"],
  "terminal-pin-lock": ["sessionId"]
};
async function handleTerminalPin(deps, terminal, route, request, body, correlationId) {
  if (!terminal.activated) return refusal("ACTIVATION_REQUIRED", correlationId);
  if (route === "terminal-pin-status") {
    if (request.rawBody !== "") return invalid(correlationId, "a GET carries no body");
    const header = request.headers[INTAKE_SESSION_HEADER];
    const sessionId = typeof header === "string" && header !== "" ? header : null;
    if (sessionId !== null && !UUID3.test(sessionId)) {
      return invalid(correlationId, `${INTAKE_SESSION_HEADER} must be a session id`);
    }
    const status = await readTerminalPinStatus(deps.pool, {
      terminalDeviceId: terminal.terminalDeviceId,
      sessionId
    });
    return { status: 200, body: { result: "TERMINAL_PIN_STATUS", correlationId, ...status } };
  }
  if (idempotencyKeyFrom(request.headers) === null) {
    return invalid(correlationId, "an Idempotency-Key header is required");
  }
  const allowed = PIN_BODY_FIELDS[route] ?? [];
  const unknown = unknownFields(body, allowed);
  if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
  const text = (key) => typeof body[key] === "string" ? body[key] : null;
  const missing = allowed.filter((key) => text(key) === null);
  if (missing.length > 0) return invalid(correlationId, "required fields are missing", missing);
  if (route === "terminal-pin-lock") {
    const sessionId = text("sessionId") ?? "";
    if (!UUID3.test(sessionId)) return invalid(correlationId, "sessionId must be a session id");
    const locked = await lockTerminalSession(deps.pool, {
      terminalDeviceId: terminal.terminalDeviceId,
      sessionId
    });
    if (locked.outcome !== "ok")
      return pinRefusal(locked, correlationId);
    return { status: 200, body: { result: locked.result, correlationId } };
  }
  const eligibility = await readRuntimeEligibility(
    deps.pool,
    terminal.terminalDeviceId,
    terminal.certificateSerial,
    deps.environment ?? "development"
  );
  if (eligibility.outcome === "refused") return refusal(eligibility.refusal, correlationId);
  if (route === "terminal-pin-setup") {
    const outcome = await setupTerminalPin(deps.pool, {
      terminalDeviceId: terminal.terminalDeviceId,
      pin: text("pin") ?? "",
      pinConfirmation: text("pinConfirmation") ?? "",
      correlationId
    });
    if (outcome.outcome !== "ok")
      return pinRefusal(outcome, correlationId);
    return {
      status: 200,
      body: {
        result: outcome.result,
        correlationId,
        session: outcome.value.session,
        pin: outcome.value.pin
      }
    };
  }
  if (route === "terminal-pin-unlock") {
    const outcome = await unlockTerminalWithPin(deps.pool, {
      terminalDeviceId: terminal.terminalDeviceId,
      pin: text("pin") ?? "",
      correlationId
    });
    if (outcome.outcome !== "ok")
      return pinRefusal(outcome, correlationId);
    return {
      status: 200,
      body: {
        result: outcome.result,
        correlationId,
        session: outcome.value.session,
        pin: outcome.value.pin
      }
    };
  }
  const changed = await changeTerminalPin(deps.pool, {
    terminalDeviceId: terminal.terminalDeviceId,
    currentPin: text("currentPin") ?? "",
    newPin: text("newPin") ?? "",
    newPinConfirmation: text("newPinConfirmation") ?? "",
    correlationId
  });
  if (changed.outcome !== "ok")
    return pinRefusal(changed, correlationId);
  return { status: 200, body: { result: changed.result, correlationId, pin: changed.value.pin } };
}
async function handleT1Intake(deps, terminal, matched, request, body, queryString, correlationId) {
  if (!terminal.activated) return refusal("ACTIVATION_REQUIRED", correlationId);
  if (Buffer.byteLength(request.rawBody ?? "", "utf8") > MAX_INTAKE_BODY_BYTES) {
    return invalid(correlationId, "the request body exceeds the intake bound");
  }
  const sessionHeader = request.headers[INTAKE_SESSION_HEADER];
  const sessionId = typeof sessionHeader === "string" ? sessionHeader : "";
  if (!UUID3.test(sessionId)) {
    return invalid(correlationId, `a ${INTAKE_SESSION_HEADER} header is required`);
  }
  const routePermission = INTAKE_ROUTE_PERMISSION[matched.route];
  if (routePermission === void 0) return refusal("INTERNAL_ERROR", correlationId);
  const authorization = await withHubTransaction(
    deps.pool,
    (client) => authorizeT1IntakeSession(client, {
      terminalDeviceId: terminal.terminalDeviceId,
      sessionId,
      routePermission
    }),
    HUB_RUNTIME_ROLE
  );
  if (!authorization.ok) return refusal(authorization.refusal, correlationId);
  const authority = authorization.authority;
  const intakeBody = body ?? {};
  const isMutation = INTAKE_MUTATIONS.includes(matched.route);
  let requestKey = "";
  let requestHash = "";
  if (isMutation) {
    const key = idempotencyKeyFrom(request.headers);
    if (key === null) {
      return invalid(correlationId, "an Idempotency-Key header is required");
    }
    requestKey = key;
    requestHash = sha256Hex3(
      JSON.stringify({
        m: request.method,
        p: request.path.split("?")[0] ?? "",
        b: body,
        t: terminal.terminalDeviceId,
        s: sessionId
      })
    );
  }
  try {
    switch (matched.route) {
      case "customers-search": {
        const params = new URLSearchParams(queryString);
        const keys = [...params.keys()];
        if (keys.length !== 1 || keys[0] !== "phone") {
          return invalid(correlationId, "exactly one `phone` query parameter is required");
        }
        const raw = params.get("phone") ?? "";
        if (raw.length < 3 || raw.length > 32) {
          return refusal("PHONE_INVALID", correlationId);
        }
        const normalized = normalizeCambodianPhone(raw);
        if (normalized === null) return refusal("PHONE_INVALID", correlationId);
        const matches = await searchCustomersByPhone(deps.pool, authority, normalized.e164);
        return {
          status: 200,
          body: {
            result: "CUSTOMER_SEARCH",
            correlationId,
            normalizedPhone: normalized.e164,
            matches
          }
        };
      }
      case "customers-read": {
        const customer = await readCustomer(deps.pool, authority, matched.customerId);
        if (customer === null) return refusal("CUSTOMER_UNKNOWN", correlationId);
        return { status: 200, body: { result: "CUSTOMER", correlationId, customer } };
      }
      case "customers-create": {
        const unknown = unknownFields(intakeBody, ["displayName", "phone", "preferredLanguage"]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const displayName = typeof body?.["displayName"] === "string" ? body["displayName"].trim() : "";
        if (displayName.length < 1 || displayName.length > NAME_MAX) {
          return invalid(correlationId, "displayName of 1..200 characters is required");
        }
        const phoneRaw = typeof body?.["phone"] === "string" ? body["phone"] : null;
        let phoneE164 = null;
        if (phoneRaw !== null) {
          const normalized = normalizeCambodianPhone(phoneRaw);
          if (normalized === null) return refusal("PHONE_INVALID", correlationId);
          phoneE164 = normalized.e164;
        }
        const language = body?.["preferredLanguage"] === "en-US" ? "en-US" : "km-KH";
        const outcome = await registerLocalCustomer(deps.pool, {
          authority,
          terminalDeviceId: terminal.terminalDeviceId,
          displayName,
          phoneE164,
          phoneRaw,
          preferredLanguage: language,
          requestKey,
          requestHash,
          correlationId
        });
        return {
          status: 200,
          body: {
            result: outcome.created ? "CUSTOMER_CREATED" : "CUSTOMER_ALREADY_CREATED",
            correlationId,
            customer: outcome.customer
          }
        };
      }
      case "customers-consent": {
        const unknown = unknownFields(intakeBody, [
          "purposeKey",
          "policyRef",
          "policyVersion",
          "decision",
          "channel",
          "staffAssisted"
        ]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const purposeKey = String(body?.["purposeKey"] ?? "");
        if (!CONSENT_PURPOSE_KEYS.includes(purposeKey)) {
          return invalid(correlationId, "purposeKey is not a registered consent purpose");
        }
        const decision = String(body?.["decision"] ?? "");
        if (!["granted", "declined", "withdrawn", "acknowledged"].includes(decision)) {
          return invalid(correlationId, "decision is not a consent decision");
        }
        const policyRef = String(body?.["policyRef"] ?? "");
        if (policyRef.length < 1 || policyRef.length > 200) {
          return invalid(correlationId, "policyRef is required");
        }
        const policyVersion = Number(body?.["policyVersion"]);
        if (!Number.isInteger(policyVersion) || policyVersion < 1) {
          return invalid(correlationId, "policyVersion must be a positive integer");
        }
        const channel = String(body?.["channel"] ?? "t1_terminal");
        if (channel.length < 1 || channel.length > 64) {
          return invalid(correlationId, "channel is out of bounds");
        }
        const staffAssisted = body?.["staffAssisted"] === false ? false : true;
        const outcome = await recordConsentDecision(deps.pool, {
          authority,
          terminalDeviceId: terminal.terminalDeviceId,
          customerId: matched.customerId,
          purposeKey,
          policyRef,
          policyVersion,
          decision,
          channel,
          staffAssisted,
          requestKey,
          requestHash,
          correlationId
        });
        return {
          status: 200,
          body: {
            result: outcome.created ? "CONSENT_RECORDED" : "CONSENT_ALREADY_RECORDED",
            correlationId,
            decisionId: outcome.decisionId,
            recordedAt: outcome.recordedAt
          }
        };
      }
      case "drafts-create": {
        const unknown = unknownFields(intakeBody, [
          "customerId",
          "walkIn",
          "preferredLanguage",
          "intakeSource",
          "customerNotes",
          "staffNotes"
        ]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const walkIn = body?.["walkIn"] === true;
        const customerId = walkIn ? null : requireShaped(intakeBody, "customerId", UUID3);
        if (!walkIn && customerId === null) {
          return invalid(correlationId, "customerId or walkIn is required");
        }
        const customerNotes = String(body?.["customerNotes"] ?? "");
        const staffNotes = String(body?.["staffNotes"] ?? "");
        if (customerNotes.length > NOTES_MAX || staffNotes.length > NOTES_MAX) {
          return invalid(correlationId, "notes exceed the bound");
        }
        const intakeSource = String(body?.["intakeSource"] ?? "t1_walkup");
        if (intakeSource.length < 1 || intakeSource.length > 64) {
          return invalid(correlationId, "intakeSource is out of bounds");
        }
        const draft = await createBookingDraft(deps.pool, {
          authority,
          terminalDeviceId: terminal.terminalDeviceId,
          environment: deps.environment ?? "development",
          customerId,
          walkIn,
          preferredLanguage: body?.["preferredLanguage"] === "en-US" ? "en-US" : "km-KH",
          intakeSource,
          customerNotes,
          staffNotes,
          requestKey,
          requestHash,
          correlationId
        });
        return { status: 200, body: { result: "DRAFT", correlationId, draft } };
      }
      case "drafts-read": {
        const draft = await readBookingDraft(deps.pool, authority, matched.draftId);
        if (draft === null) return refusal("DRAFT_UNKNOWN", correlationId);
        return { status: 200, body: { result: "DRAFT", correlationId, draft } };
      }
      case "drafts-update": {
        const unknown = unknownFields(intakeBody, [
          "expectedVersion",
          "customerNotes",
          "staffNotes",
          "preferredLanguage"
        ]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const expectedVersion = Number(body?.["expectedVersion"]);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return invalid(correlationId, "expectedVersion must be a positive integer");
        }
        const customerNotes = typeof body?.["customerNotes"] === "string" ? body["customerNotes"] : void 0;
        const staffNotes = typeof body?.["staffNotes"] === "string" ? body["staffNotes"] : void 0;
        if (customerNotes !== void 0 && customerNotes.length > NOTES_MAX || staffNotes !== void 0 && staffNotes.length > NOTES_MAX) {
          return invalid(correlationId, "notes exceed the bound");
        }
        const preferredLanguage = body?.["preferredLanguage"] === "en-US" ? "en-US" : body?.["preferredLanguage"] === "km-KH" ? "km-KH" : void 0;
        const draft = await updateBookingDraft(deps.pool, {
          authority,
          terminalDeviceId: terminal.terminalDeviceId,
          draftId: matched.draftId,
          expectedVersion,
          customerNotes,
          staffNotes,
          preferredLanguage,
          requestKey,
          requestHash,
          correlationId
        });
        return { status: 200, body: { result: "DRAFT", correlationId, draft } };
      }
      case "drafts-cancel": {
        const unknown = unknownFields(intakeBody, ["reasonCode"]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const reasonCode = String(body?.["reasonCode"] ?? "");
        if (!DRAFT_CANCEL_REASONS.includes(reasonCode)) {
          return invalid(correlationId, "reasonCode is not a governed cancel reason");
        }
        const draft = await cancelBookingDraft(deps.pool, {
          authority,
          terminalDeviceId: terminal.terminalDeviceId,
          draftId: matched.draftId,
          reasonCode,
          requestKey,
          requestHash,
          correlationId
        });
        return { status: 200, body: { result: "DRAFT_CANCELLED", correlationId, draft } };
      }
    }
  } catch (error) {
    if (error instanceof IntakeRefusalError) {
      return refusal(error.refusal, correlationId);
    }
    throw error;
  }
}
var OPERATION_ROUTE_PERMISSION = {
  // Pricing the draft's lines is shaping the draft toward a Booking — the
  // draft-workspace permission the T002 draft routes already reuse.
  "drafts-quote": PERMISSION_BOOKINGS_CREATE,
  // The approved route's registered permission (edge-contracts registry).
  "bookings-confirm": PERMISSION_BOOKINGS_CREATE,
  "bookings-recent": PERMISSION_BOOKINGS_READ
};
var MONEY_STRING = /^[0-9]{1,18}$/;
function parseIntakeLines(value) {
  if (!Array.isArray(value) || value.length > MAX_INTAKE_LINES) return null;
  const lines = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const line = raw;
    if (unknownFields(line, ["serviceId", "pieceCount", "weighedGrams"]).length > 0) return null;
    const serviceId = line["serviceId"];
    if (typeof serviceId !== "string" || !UUID3.test(serviceId)) return null;
    const pieceCount = line["pieceCount"];
    const weighedGrams = line["weighedGrams"];
    const hasPieces = pieceCount !== void 0;
    const hasWeight = weighedGrams !== void 0;
    if (hasPieces === hasWeight) return null;
    if (hasPieces) {
      if (typeof pieceCount !== "number" || !Number.isInteger(pieceCount) || pieceCount < 1)
        return null;
      lines.push({ serviceId: serviceId.toLowerCase(), pieceCount });
    } else {
      if (typeof weighedGrams !== "number" || !Number.isInteger(weighedGrams) || weighedGrams < 1)
        return null;
      lines.push({ serviceId: serviceId.toLowerCase(), weighedGrams });
    }
  }
  return lines;
}
function commandRefusal(error, correlationId) {
  const named = error.details["result"];
  const result = typeof named === "string" && named !== "" ? named : error.code;
  const code = CANONICAL_ERROR[result] ?? CANONICAL_ERROR[error.code] ?? "INTERNAL_ERROR";
  const { result: _omitted, ...rest } = error.details;
  void _omitted;
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, CANONICAL_MESSAGE[code] ?? "the request was refused", {
      correlationId,
      details: { result, retryable: isRetryable(code), ...redactDetails(rest) }
    })
  };
}
function redactDetails(details) {
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (value === null) {
      out[key] = null;
    }
  }
  return out;
}
async function handleT1Operations(deps, terminal, matched, request, body, correlationId) {
  if (!terminal.activated) return refusal("ACTIVATION_REQUIRED", correlationId);
  if (Buffer.byteLength(request.rawBody ?? "", "utf8") > MAX_OPERATION_BODY_BYTES) {
    return invalid(correlationId, "the request body exceeds the operation bound");
  }
  const sessionHeader = request.headers[INTAKE_SESSION_HEADER];
  const sessionId = typeof sessionHeader === "string" ? sessionHeader : "";
  if (!UUID3.test(sessionId)) {
    return invalid(correlationId, `a ${INTAKE_SESSION_HEADER} header is required`);
  }
  const routePermission = OPERATION_ROUTE_PERMISSION[matched.route];
  if (routePermission === void 0) return refusal("INTERNAL_ERROR", correlationId);
  const authorization = await withHubTransaction(
    deps.pool,
    (client) => authorizeT1IntakeSession(client, {
      terminalDeviceId: terminal.terminalDeviceId,
      sessionId,
      routePermission
    }),
    HUB_RUNTIME_ROLE
  );
  if (!authorization.ok) return refusal(authorization.refusal, correlationId);
  const authority = authorization.authority;
  const operationBody = body ?? {};
  const environment = deps.environment ?? "development";
  try {
    switch (matched.route) {
      case "bookings-recent": {
        if (request.rawBody !== "") return invalid(correlationId, "a GET carries no body");
        const bookings = await listRecentBookings(deps.pool, authority);
        return { status: 200, body: { result: "RECENT_BOOKINGS", correlationId, bookings } };
      }
      case "drafts-quote": {
        const unknown = unknownFields(operationBody, ["lines", "express"]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const lines = parseIntakeLines(operationBody["lines"]);
        if (lines === null)
          return invalid(correlationId, "lines must be a bounded list of priced lines");
        const express = operationBody["express"] === true;
        const quote = await quoteDraftIntake(deps.pool, authority, {
          draftId: matched.draftId,
          lines,
          express
        });
        return { status: 200, body: { result: "QUOTE", correlationId, quote } };
      }
      case "bookings-confirm": {
        const key = idempotencyKeyFrom(request.headers);
        if (key === null) return invalid(correlationId, "an Idempotency-Key header is required");
        const unknown = unknownFields(operationBody, [
          "expectedVersion",
          "lines",
          "express",
          "displayedTotalMinor",
          "tender"
        ]);
        if (unknown.length > 0) return invalid(correlationId, "unknown fields", unknown);
        const expectedVersion = operationBody["expectedVersion"];
        if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return invalid(correlationId, "expectedVersion must be a positive integer");
        }
        const lines = parseIntakeLines(operationBody["lines"]);
        if (lines === null || lines.length === 0) {
          return invalid(correlationId, "lines must be a non-empty bounded list of priced lines");
        }
        const express = operationBody["express"] === true;
        const displayed = operationBody["displayedTotalMinor"];
        if (typeof displayed !== "string" || !MONEY_STRING.test(displayed)) {
          return invalid(correlationId, "displayedTotalMinor must be a decimal minor-unit string");
        }
        const tender = operationBody["tender"];
        if (typeof tender !== "object" || tender === null || Array.isArray(tender)) {
          return invalid(correlationId, "tender is required");
        }
        const tenderBody = tender;
        const unknownTender = unknownFields(tenderBody, ["type", "localMinor", "usdCents"]);
        if (unknownTender.length > 0)
          return invalid(correlationId, "unknown fields", unknownTender);
        if (tenderBody["type"] !== "cash") {
          return invalid(correlationId, "tender.type must be cash (owner decision 2026-09-19)");
        }
        const localMinor = tenderBody["localMinor"] ?? "0";
        const usdCents = tenderBody["usdCents"] ?? "0";
        if (typeof localMinor !== "string" || !MONEY_STRING.test(localMinor) || typeof usdCents !== "string" || !MONEY_STRING.test(usdCents)) {
          return invalid(correlationId, "tender amounts must be decimal minor-unit strings");
        }
        const outcome = await confirmDraftIntakeForTerminal(deps.pool, {
          terminalDeviceId: terminal.terminalDeviceId,
          authority,
          environment,
          idempotencyKey: key,
          correlationId,
          draftId: matched.draftId,
          expectedVersion,
          lines,
          express,
          displayedTotalMinor: BigInt(displayed),
          tender: { localMinor: BigInt(localMinor), usdCents: BigInt(usdCents) }
        });
        if (outcome.outcome === "in_progress") {
          return {
            status: 202,
            body: { result: "BOOKING_CONFIRM_IN_PROGRESS", correlationId, ...outcome.result }
          };
        }
        return {
          status: 200,
          body: {
            result: outcome.outcome === "duplicate" ? "BOOKING_CONFIRMED_REPLAYED" : "BOOKING_CONFIRMED",
            correlationId,
            commandOutcome: outcome.outcome,
            aggregateId: outcome.aggregateId,
            syncState: outcome.wireSyncState,
            ...outcome.result
          }
        };
      }
    }
  } catch (error) {
    if (error instanceof HubCommandError) return commandRefusal(error, correlationId);
    throw error;
  }
}

// src/hub/edge/transport.ts
import { createServer } from "node:https";
var EDGE_TLS_PORT = 7443;
var MAX_BODY_BYTES = 64 * 1024;
var NO_LOG4 = { info: () => void 0 };
var FORBIDDEN_BINDS = /* @__PURE__ */ new Set(["0.0.0.0", "::", "*", ""]);
function normalizeHex(value) {
  return value.replace(/:/g, "").toLowerCase();
}
function createEdgeTlsServer(options) {
  if (FORBIDDEN_BINDS.has(options.bindHost.trim())) {
    throw new Error(
      "KLUY-EDGE-TRANSPORT-BIND-REFUSED: the Store LAN listener binds an approved interface explicitly; wildcard/public ingress is not available (owner package \xA73)"
    );
  }
  const logger = options.logger ?? NO_LOG4;
  const server = createServer(
    {
      key: options.key,
      cert: options.cert,
      ca: options.clientCa,
      // TLS 1.3 ONLY — min and max pinned (owner package §3).
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      // MANDATORY mutual TLS: no certificate, no handshake.
      requestCert: true,
      rejectUnauthorized: true
    },
    (req, res) => {
      void serve(req, res, options.handler, logger);
    }
  );
  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? EDGE_TLS_PORT, options.bindHost, () => {
          const address = server.address();
          const port = typeof address === "object" && address !== null ? address.port : 0;
          logger.info({ operation: "edgeTlsListen", correlationId: "-", result: String(port) });
          resolve({ port });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
async function serve(req, res, handler2, logger) {
  try {
    const socket = req.socket;
    const peerCertificate = socket.getPeerCertificate(false);
    if (peerCertificate === null || typeof peerCertificate !== "object" || typeof peerCertificate.serialNumber !== "string" || peerCertificate.serialNumber === "") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "AUTHENTICATION_REQUIRED", message: "a client certificate is required" }
        })
      );
      return;
    }
    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "the request body exceeds the bound" }
        })
      );
      return;
    }
    const response = await handler2.handle({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: req.headers,
      rawBody,
      peer: {
        certificateSerial: normalizeHex(peerCertificate.serialNumber),
        certificateFingerprint: normalizeHex(peerCertificate.fingerprint256 ?? ""),
        subjectCommonName: String(peerCertificate.subject?.CN ?? "")
      }
    });
    res.writeHead(response.status, {
      "content-type": "application/json",
      ...response.headers ?? {}
    });
    res.end(JSON.stringify(response.body));
  } catch {
    logger.info({ operation: "edgeTlsServe", correlationId: "-", result: "INTERNAL_ERROR" });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(
      JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "the request could not be served" }
      })
    );
  }
}
async function readBoundedBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return "";
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk;
    total += buf.length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// src/hub/edge/development-listener.ts
var DEVICE_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";
var OPERATIONAL_DIR = "/var/lib/kitluy/operational";
var PAIRING_STATE_PATH = "/var/lib/kitluy/pairing-state.json";
function readJson(read, path) {
  try {
    const parsed = JSON.parse(read(path));
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function stringField(record, key) {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function composeDevelopmentListener(inputs) {
  const read = inputs.readFile ?? ((p) => readFileSync2(p, "utf8"));
  if (inputs.environment !== "development") {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-PENDING",
      detail: `the terminal listener is a development-only path and this Hub is running in "${inputs.environment}"; pairing and discovery composition for pilot and production requires the BLK-005 operational signer`
    };
  }
  const operationalDir = inputs.operationalDir ?? OPERATIONAL_DIR;
  const credential = readJson(read, join(operationalDir, "operational-credential.json"));
  const pairing = readJson(read, inputs.pairingStatePath ?? PAIRING_STATE_PATH);
  if (stringField(credential, "phase") !== "ADOPTED") {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-NO-CREDENTIAL",
      detail: `no adopted operational credential; the Hub has not completed certificate issuance (expected phase ADOPTED in ${join(operationalDir, "operational-credential.json")})`
    };
  }
  const certificateSerial = stringField(credential, "certificateSerial");
  const hubDeviceId2 = stringField(credential, "deviceRecordId");
  const tenantId = stringField(pairing, "tenantId");
  const digitalStoreId = stringField(pairing, "digitalStoreId");
  const storeLocationId = stringField(pairing, "storeLocationId");
  const missing = [];
  if (certificateSerial === void 0) missing.push("certificateSerial");
  if (hubDeviceId2 === void 0) missing.push("deviceRecordId");
  if (tenantId === void 0) missing.push("tenantId");
  if (digitalStoreId === void 0) missing.push("digitalStoreId");
  if (storeLocationId === void 0) missing.push("storeLocationId");
  if (missing.length > 0) {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-UNPAIRED",
      detail: `the Hub is not bound to a Store scope (missing: ${missing.join(", ")}). A discovery record names the Tenant, Store and Location it serves; there is nothing to name yet.`
    };
  }
  let signer;
  try {
    const privateKey = createPrivateKey2(read(inputs.identityKeyPath ?? DEVICE_IDENTITY_KEY_PATH));
    const publicKeyPem = createPublicKey2(privateKey).export({ type: "spki", format: "pem" }).toString();
    const signingCredentialSerial = createHash9("sha256").update(createPublicKey2(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
    signer = {
      certificateSerial: signingCredentialSerial,
      publicKeyPem,
      sign: (payload) => cryptoSign(null, Buffer.from(payload), privateKey)
    };
  } catch (error) {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-NO-IDENTITY-KEY",
      detail: `the device identity key at ${inputs.identityKeyPath ?? DEVICE_IDENTITY_KEY_PATH} could not be loaded: ` + (error instanceof Error ? error.message : String(error))
    };
  }
  return {
    kind: "composed",
    signer,
    identity: {
      hubDeviceId: hubDeviceId2,
      hubTlsCertificateFingerprint: inputs.tlsCertificateFingerprint,
      tenantId,
      digitalStoreId,
      storeLocationId,
      environment: inputs.environment,
      hostname: inputs.hostname ?? osHostname(),
      port: EDGE_TLS_PORT
    }
  };
}
async function startDevelopmentListener(options) {
  const discovery = new EdgeDiscoveryAuthority(
    options.composition.identity,
    options.composition.signer,
    options.logger
  );
  const handler2 = createEdgeTerminalRouter({
    pool: options.pool,
    environment: options.environment,
    pairing: new TerminalPairingComposition(
      options.pool,
      options.composition.signer,
      options.logger
    ),
    // Fails closed as UNREACHABLE. Terminal activation is not this milestone.
    activationGateway: unavailableActivationGateway(),
    discovery,
    // THE DELIVERY SIGNER, IN DEVELOPMENT ONLY (owner decision 2026-09-10).
    //
    // This was omitted, so `/edge/v1/configuration/current` failed closed with
    // DELIVERY_SIGNER_UNAVAILABLE rather than serving a configuration signed by
    // a development key. On hardware that left a genuine, recognised, paired Pi
    // Terminal unable to read the configuration it needs to trade, with no path
    // forward short of the BLK-006 cloud publisher.
    //
    // The GUARD is the point: it is wired only when the image declares
    // `development`, so pilot and production reach the same fail-closed refusal
    // they always did and BLK-005 signer custody is untouched.
    // `composeDevelopmentListener` already refuses to build any signer at all
    // outside development (KLUY-HUB-EDGE-BLK005); this is the second lock on
    // the same door.
    ...options.environment === "development" ? { deliverySigner: options.composition.signer } : {},
    ...options.logger === void 0 ? {} : { logger: options.logger }
  });
  const server = createEdgeTlsServer({
    key: options.tls.key,
    cert: options.tls.cert,
    clientCa: options.tls.clientCa,
    bindHost: options.bindHost,
    port: EDGE_TLS_PORT,
    handler: handler2,
    ...options.logger === void 0 ? {} : { logger: options.logger }
  });
  const { port } = await server.listen();
  return { port, close: () => server.close() };
}

// src/hub/terminal-sync/index.ts
init_dist2();
import { createPrivateKey as createPrivateKey3, createPublicKey as createPublicKey5, randomBytes as randomBytes5 } from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";

// src/hub/terminal-sync/apply.ts
init_db();
init_dev_configuration();
import { X509Certificate, createHash as createHash12, createPublicKey as createPublicKey4 } from "node:crypto";

// src/hub/terminal-sync/contract.ts
import {
  createHash as createHash11,
  createPublicKey as createPublicKey3,
  sign as edSign,
  verify as edVerify
} from "node:crypto";
var HUB_SYNC_REQUEST_KIND = "kitluy.hub-sync.request.v1";
var HUB_SYNC_ENVELOPE_KIND = "kitluy.hub-sync.terminal-projections.v1";
var TERMINAL_PROJECTION_KIND = "kitluy.hub.development-terminal-projection.v1";
var HUB_SYNC_TRUST_RECORD_KIND = "kitluy.hub-sync-trust-key.v1";
var HUB_SYNC_SIGNING_PURPOSE = "transport_signing";
var REQUEST_MAX_SKEW_SECONDS = 300;
var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
var HEX644 = /^[0-9a-f]{64}$/u;
var SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
var NONCE = /^[0-9a-f]{32}$/u;
function hasControlCharacter(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function canonicalJson2(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson2(v)).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson2(record[k])}`).join(",")}}`;
}
function publicKeyFingerprint2(publicKeyPem) {
  const der = createPublicKey3(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash11("sha256").update(der).digest("hex");
}
function hubSyncRequestBytes(input) {
  if (!HEX644.test(input.identityPublicKeyFingerprint)) {
    throw new Error(
      "KLUY-HUB-SYNC-MALFORMED: the identity key fingerprint must be lowercase sha-256 hex"
    );
  }
  if (!UUID4.test(input.hubDeviceId)) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: hubDeviceId is not a uuid");
  }
  if (!NONCE.test(input.nonce)) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: nonce must be 32 hex characters");
  }
  if (input.requestedAt.length > 64 || hasControlCharacter(input.requestedAt)) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: requestedAt is invalid");
  }
  return Buffer.from(
    [
      HUB_SYNC_REQUEST_KIND,
      input.identityPublicKeyFingerprint,
      input.hubDeviceId.toLowerCase(),
      input.requestedAt,
      input.nonce
    ].join("\n"),
    "utf8"
  );
}
function hubSyncEnvelopeBytes(envelope) {
  if (envelope.kind !== HUB_SYNC_ENVELOPE_KIND) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: the envelope declares the wrong kind");
  }
  const digest = createHash11("sha256").update(canonicalJson2(envelope), "utf8").digest("hex");
  return Buffer.from([HUB_SYNC_ENVELOPE_KIND, digest].join("\n"), "utf8");
}
function signBytes(privateKey, bytes) {
  return Buffer.from(edSign(null, bytes, privateKey)).toString("base64url");
}
function verifyBytes(publicKey, bytes, signature) {
  if (!SIGNATURE.test(signature)) return false;
  try {
    return edVerify(null, bytes, publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

// src/hub/terminal-sync/apply.ts
function parseCatalogSection(value) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const r = value;
  if (r["schema"] !== "kitluy.config.catalog.v1") return null;
  if (typeof r["currency_code"] !== "string" || !/^[A-Z]{3}$/u.test(r["currency_code"]))
    return null;
  if (typeof r["content_hash"] !== "string" || !HEX644.test(r["content_hash"])) return null;
  if (!Array.isArray(r["services"])) return null;
  return r;
}
function parseMoneySection(value) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const r = value;
  if (r["schema"] !== "kitluy.config.money.v1") return null;
  if (typeof r["currency_code"] !== "string" || !/^[A-Z]{3}$/u.test(r["currency_code"]))
    return null;
  if (typeof r["currency_exponent"] !== "number" || !Number.isInteger(r["currency_exponent"]))
    return null;
  return r;
}
var PROFILE3 = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/u;
var NAME = /^[A-Za-z0-9 ._:-]{1,80}$/u;
var HARDWARE_PROFILE = /^[a-z0-9_.]{1,80}$/u;
var SERIAL = /^[0-9a-f]{2,80}$/u;
var LABEL = /^[A-Za-z0-9._:-]{1,120}$/u;
function str2(record, key, pattern) {
  const value = record[key];
  if (typeof value !== "string" || value === "") return void 0;
  if (pattern !== void 0 && !pattern.test(value)) return void 0;
  return value;
}
function instant(record, key) {
  const value = record[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return void 0;
  return new Date(value).toISOString();
}
function parseTerminalDelivery(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "delivery is not an object" };
  }
  const d = value;
  if (d["kind"] !== TERMINAL_PROJECTION_KIND) return { ok: false, reason: "wrong delivery kind" };
  const terminalDeviceId = str2(d, "terminalDeviceId", UUID4);
  const credentialId = str2(d, "credentialId", UUID4);
  const tenantId = str2(d, "tenantId", UUID4);
  const digitalStoreId = str2(d, "digitalStoreId", UUID4);
  const storeLocationId = str2(d, "storeLocationId", UUID4);
  const installationId = str2(d, "installationId", UUID4);
  const terminalName = str2(d, "terminalName", NAME);
  const hardwareProfileCode = str2(d, "hardwareProfileCode", HARDWARE_PROFILE);
  const x509CertificateSerial = str2(d, "x509CertificateSerial", SERIAL);
  const credentialSerialLabel = str2(d, "credentialSerialLabel", LABEL);
  const publicKeyFingerprint3 = str2(d, "publicKeyFingerprint", HEX644);
  const issuer = str2(d, "issuer");
  const issuedAt = instant(d, "issuedAt");
  const expiresAt = instant(d, "expiresAt");
  const generation = d["assignmentGeneration"];
  const certGeneration = d["certificateGeneration"];
  const profiles = d["profileCodes"];
  const identity = d["identityKeyFingerprint"];
  const seat = d["seatLabel"];
  for (const [name, present] of [
    ["terminalDeviceId", terminalDeviceId],
    ["credentialId", credentialId],
    ["tenantId", tenantId],
    ["digitalStoreId", digitalStoreId],
    ["storeLocationId", storeLocationId],
    ["installationId", installationId],
    ["terminalName", terminalName],
    ["hardwareProfileCode", hardwareProfileCode],
    ["x509CertificateSerial", x509CertificateSerial],
    ["credentialSerialLabel", credentialSerialLabel],
    ["publicKeyFingerprint", publicKeyFingerprint3],
    ["issuer", issuer],
    ["issuedAt", issuedAt],
    ["expiresAt", expiresAt]
  ]) {
    if (present === void 0) return { ok: false, reason: `${name} is missing or malformed` };
  }
  if (typeof issuer !== "string" || issuer.length > 200) {
    return { ok: false, reason: "issuer is missing or too long" };
  }
  if (!Number.isInteger(generation) || generation < 1) {
    return { ok: false, reason: "assignmentGeneration must be a positive integer" };
  }
  if (!Number.isInteger(certGeneration) || certGeneration < 1) {
    return { ok: false, reason: "certificateGeneration must be a positive integer" };
  }
  if (!Array.isArray(profiles) || profiles.some((p) => typeof p !== "string" || !PROFILE3.test(p))) {
    return { ok: false, reason: "profileCodes must be canonical dotted profiles" };
  }
  if (identity !== null && identity !== void 0 && (typeof identity !== "string" || !HEX644.test(identity))) {
    return { ok: false, reason: "identityKeyFingerprint is not a sha256 hex digest" };
  }
  if (seat !== null && seat !== void 0 && (typeof seat !== "string" || seat.length > 120)) {
    return { ok: false, reason: "seatLabel is malformed" };
  }
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    return { ok: false, reason: "the credential window is empty" };
  }
  return {
    ok: true,
    delivery: {
      kind: TERMINAL_PROJECTION_KIND,
      terminalDeviceId: terminalDeviceId.toLowerCase(),
      terminalName,
      hardwareProfileCode,
      installationId: installationId.toLowerCase(),
      tenantId: tenantId.toLowerCase(),
      digitalStoreId: digitalStoreId.toLowerCase(),
      storeLocationId: storeLocationId.toLowerCase(),
      assignmentGeneration: generation,
      profileCodes: [...new Set(profiles)],
      seatLabel: typeof seat === "string" ? seat : null,
      credentialId: credentialId.toLowerCase(),
      certificateGeneration: certGeneration,
      x509CertificateSerial: x509CertificateSerial.toLowerCase(),
      identityKeyFingerprint: typeof identity === "string" ? identity : null,
      credentialSerialLabel,
      publicKeyFingerprint: publicKeyFingerprint3,
      issuer,
      issuedAt,
      expiresAt
    }
  };
}
function sha256Hex4(input) {
  return createHash12("sha256").update(input).digest("hex");
}
function md5Uuid(label) {
  const hex = createHash12("md5").update(label).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function certificateFacts(pem) {
  const cert = new X509Certificate(pem);
  return {
    serial: cert.serialNumber.toLowerCase(),
    publicKeyFingerprint: sha256Hex4(cert.publicKey.export({ type: "spki", format: "der" })),
    issuer: cert.issuer.replace(/\n/gu, ", ").slice(0, 180),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString()
  };
}
async function projectHubSelf(client, facts, primaryVertical) {
  const cert = certificateFacts(facts.operationalCertificatePem);
  const identityFingerprint = facts.identityPublicKeyPem === null ? null : sha256Hex4(
    createPublicKey4(facts.identityPublicKeyPem).export({ type: "spki", format: "der" })
  );
  await client.query(
    `insert into edge_identity.hub_device
       (id, asset_number, device_kind, lifecycle_status, trust_status,
        board_serial_hash, factory_duid_hash, root_key_fingerprint,
        manufacturing_cert_serial, created_at, updated_at)
     values ($1::uuid, $6, 'store_hub', 'deployed', 'trusted',
             $2, $3, $4, $5, now(), now())
     on conflict (id) do update
        set lifecycle_status = 'deployed',
            trust_status = 'trusted',
            manufacturing_cert_serial = excluded.manufacturing_cert_serial,
            updated_at = now()`,
    [
      facts.hubDeviceId,
      sha256Hex4(facts.boardSerial),
      // Self-describing DEVELOPMENT placeholders, as the shell door wrote them:
      // no factory DUID and no root key exist in this development cloud.
      sha256Hex4(`kitluy.development-projection.factory-duid:${facts.hubDeviceId}`),
      sha256Hex4(`kitluy.development-projection.root-key:${facts.hubDeviceId}`),
      cert.serial,
      // Unique per Hub (the column is unique): a board projected by the shell
      // door keeps its 'KITLUY-DEV-HUB' — the update path leaves the number alone.
      `KITLUY-DEV-HUB-${facts.hubDeviceId.slice(0, 8)}`
    ]
  );
  await client.query(
    `update edge_identity.hub_assignment
        set status = 'ended', ended_at = now()
      where status = 'active' and id <> $1::uuid`,
    [facts.assignmentId]
  );
  await client.query(
    `insert into edge_identity.hub_assignment
       (id, hub_device_id, tenant_id, digital_store_id, location_id,
        assignment_generation, assigned_at, ended_at, status, operational_cert_serial,
        primary_vertical_code)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, now(), null, 'active', $7, $8)
     on conflict (id) do update
        set ended_at = null,
            status = 'active',
            assignment_generation = excluded.assignment_generation,
            operational_cert_serial = excluded.operational_cert_serial,
            primary_vertical_code = excluded.primary_vertical_code`,
    [
      facts.assignmentId,
      facts.hubDeviceId,
      facts.scope.tenantId,
      facts.scope.digitalStoreId,
      facts.scope.storeLocationId,
      facts.assignmentGeneration,
      cert.serial,
      primaryVertical
    ]
  );
  const operationalId = md5Uuid(`kitluy.hub-operational-credential:${cert.serial}`);
  const identityId = identityFingerprint === null ? null : md5Uuid(`kitluy.hub-identity-credential:${identityFingerprint}`);
  await supersedeHubCredentials(client, facts.hubDeviceId, "operational_tls", operationalId);
  if (identityId !== null) {
    await supersedeHubCredentials(client, facts.hubDeviceId, "device_identity", identityId);
  }
  await upsertCredential(client, {
    id: operationalId,
    deviceId: facts.hubDeviceId,
    type: "operational_tls",
    fingerprint: cert.publicKeyFingerprint,
    serial: cert.serial,
    issuer: cert.issuer,
    issuedAt: cert.notBefore,
    expiresAt: cert.notAfter,
    // The pairing generation, as projectTerminal does -- not a hard-coded 1,
    // which made every installation of this Hub look equally current.
    generation: facts.assignmentGeneration
  });
  if (identityId !== null && identityFingerprint !== null) {
    await upsertCredential(client, {
      id: identityId,
      deviceId: facts.hubDeviceId,
      type: "device_identity",
      fingerprint: identityFingerprint,
      serial: identityFingerprint,
      issuer: cert.issuer,
      issuedAt: cert.notBefore,
      expiresAt: cert.notAfter,
      generation: facts.assignmentGeneration
    });
  }
  return { identityCredential: identityFingerprint !== null };
}
async function supersedeHubCredentials(client, hubDeviceId2, type, currentId) {
  await client.query(
    `update edge_identity.device_credential
        set status = 'superseded'
      where device_id = $1::uuid and credential_type = $2 and id <> $3::uuid
        and status = 'active'`,
    [hubDeviceId2, type, currentId]
  );
}
async function upsertCredential(client, c) {
  await client.query(
    `insert into edge_identity.device_credential
       (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
        issuer, issued_at, expires_at, status, rotation_generation)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, 'active', $9)
     on conflict (id) do update
        set certificate_serial = excluded.certificate_serial,
            public_key_fingerprint = excluded.public_key_fingerprint,
            expires_at = excluded.expires_at,
            status = 'active',
            revoked_at = null,
            revocation_reason = null`,
    [
      c.id,
      c.deviceId,
      c.type,
      c.fingerprint,
      c.serial,
      c.issuer,
      c.issuedAt,
      c.expiresAt,
      c.generation
    ]
  );
}
async function projectTerminal(client, delivery, now = /* @__PURE__ */ new Date()) {
  const base = { terminalName: delivery.terminalName, terminalDeviceId: delivery.terminalDeviceId };
  if (Date.parse(delivery.expiresAt) <= now.getTime()) {
    return { ...base, action: "refused", detail: "the credential has expired" };
  }
  const profile = await client.query(
    `select id from edge_config.hardware_profile where profile_code = $1`,
    [delivery.hardwareProfileCode]
  );
  const hardwareProfileId = profile.rows[0]?.id;
  if (hardwareProfileId === void 0) {
    return {
      ...base,
      action: "refused",
      detail: `this Hub holds no hardware profile ${delivery.hardwareProfileCode}`
    };
  }
  const existing = await client.query(
    `select certificate_serial, assignment_generation, lifecycle_status, terminal_name
       from edge_identity.terminal_device where id = $1::uuid`,
    [delivery.terminalDeviceId]
  );
  const current = existing.rows[0];
  const identityHeld = delivery.identityKeyFingerprint === null ? true : (await client.query(
    `select 1 from edge_identity.device_credential
              where device_id = $1::uuid and credential_type = 'device_identity'
                and public_key_fingerprint = $2 and status = 'active'`,
    [delivery.terminalDeviceId, delivery.identityKeyFingerprint]
  )).rowCount === 1;
  if (current !== void 0 && current.certificate_serial === delivery.x509CertificateSerial && current.assignment_generation === delivery.assignmentGeneration && current.lifecycle_status === "active" && current.terminal_name === delivery.terminalName && identityHeld) {
    return { ...base, action: "unchanged" };
  }
  let retiredPrevious;
  const sameName = await client.query(
    `select id, lifecycle_status from edge_identity.terminal_device
      where location_id = $1::uuid and terminal_name = $2 and id <> $3::uuid`,
    [delivery.storeLocationId, delivery.terminalName, delivery.terminalDeviceId]
  );
  for (const row of sameName.rows) {
    await client.query(
      `update edge_identity.terminal_device
          set lifecycle_status = 'retired',
              terminal_name = $2,
              updated_at = now()
        where id = $1::uuid`,
      [row.id, `${delivery.terminalName}~retired-${row.id.slice(0, 8)}`]
    );
    await client.query(
      `update edge_identity.device_credential
          set status = 'superseded'
        where device_id = $1::uuid and status = 'active'`,
      [row.id]
    );
    retiredPrevious = row.id;
  }
  await client.query(
    `insert into edge_identity.terminal_device
       (id, tenant_id, digital_store_id, location_id, terminal_name, hardware_profile_id,
        installation_id, certificate_serial, assignment_generation, lifecycle_status,
        last_client_sequence, last_seen_at, created_at, updated_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::uuid, $8, $9, 'active',
             0, now(), now(), now())
     on conflict (id) do update
        set certificate_serial    = excluded.certificate_serial,
            terminal_name         = excluded.terminal_name,
            assignment_generation = excluded.assignment_generation,
            lifecycle_status      = 'active',
            updated_at            = now()`,
    [
      delivery.terminalDeviceId,
      delivery.tenantId,
      delivery.digitalStoreId,
      delivery.storeLocationId,
      delivery.terminalName,
      hardwareProfileId,
      delivery.installationId,
      delivery.x509CertificateSerial,
      delivery.assignmentGeneration
    ]
  );
  await client.query(
    `update edge_identity.device_credential
        set status = 'superseded'
      where device_id = $1::uuid and credential_type = 'operational_tls'
        and id <> $2::uuid and status = 'active'`,
    [delivery.terminalDeviceId, delivery.credentialId]
  );
  await upsertCredential(client, {
    id: delivery.credentialId,
    deviceId: delivery.terminalDeviceId,
    type: "operational_tls",
    fingerprint: delivery.publicKeyFingerprint,
    serial: delivery.x509CertificateSerial,
    issuer: delivery.issuer,
    issuedAt: delivery.issuedAt,
    expiresAt: delivery.expiresAt,
    generation: delivery.assignmentGeneration
  });
  if (delivery.identityKeyFingerprint !== null) {
    await upsertCredential(client, {
      id: md5Uuid(`kitluy.terminal-identity-credential:${delivery.identityKeyFingerprint}`),
      deviceId: delivery.terminalDeviceId,
      type: "device_identity",
      fingerprint: delivery.identityKeyFingerprint,
      serial: delivery.identityKeyFingerprint,
      issuer: delivery.issuer,
      issuedAt: delivery.issuedAt,
      expiresAt: delivery.expiresAt,
      generation: delivery.assignmentGeneration
    });
  }
  return {
    ...base,
    action: "projected",
    ...retiredPrevious === void 0 ? {} : { retiredPrevious }
  };
}
async function readActiveGrantSet(client, locationId) {
  const { rows } = await client.query(
    `select tpa.terminal_device_id, tpa.profile_code
       from edge_config.terminal_profile_assignment tpa
       join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
      where tpa.location_id = $1::uuid
        and tpa.enabled
        and tpa.effective_from <= now()
        and (tpa.effective_until is null or tpa.effective_until > now())
        and cs.state = 'active'
        and tpa.assignment_version = (
          select max(x.assignment_version)
            from edge_config.terminal_profile_assignment x
            join edge_config.configuration_snapshot xs on xs.id = x.source_snapshot_id
           where x.terminal_device_id = tpa.terminal_device_id
             and x.enabled
             and x.effective_from <= now()
             and (x.effective_until is null or x.effective_until > now())
             and xs.state = 'active')`,
    [locationId]
  );
  const set = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const list = set.get(row.terminal_device_id) ?? [];
    list.push(row.profile_code);
    set.set(row.terminal_device_id, list);
  }
  return new Map([...set].map(([k, v]) => [k, [...v].sort()]));
}
function desiredGrantSet(deliveries) {
  const set = /* @__PURE__ */ new Map();
  for (const d of deliveries) {
    if (d.profileCodes.length > 0) set.set(d.terminalDeviceId, [...d.profileCodes].sort());
  }
  return set;
}
function grantSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [terminal, profiles] of a) {
    const other = b.get(terminal);
    if (other === void 0 || other.length !== profiles.length) return false;
    if (other.some((p, i) => p !== profiles[i])) return false;
  }
  return true;
}
async function readActiveSections(client, locationId) {
  const { rows } = await client.query(
    `select s.section_code, s.content_json
       from edge_config.configuration_section s
       join edge_config.active_configuration a on a.snapshot_id = s.snapshot_id
      where a.location_id = $1::uuid and s.section_code in ('catalog', 'pricing')`,
    [locationId]
  );
  const catalog = rows.find((r) => r.section_code === "catalog")?.content_json;
  const pricing = rows.find((r) => r.section_code === "pricing")?.content_json ?? null;
  const hash = catalog?.["content_hash"];
  return { catalogHash: typeof hash === "string" ? hash : null, pricing };
}
async function applyEnvelope(pool, input) {
  const now = input.now ?? /* @__PURE__ */ new Date();
  const scope = input.self.scope;
  const inScope = [];
  const refusedScope = [];
  for (const d of input.deliveries) {
    if (d.tenantId !== scope.tenantId || d.digitalStoreId !== scope.digitalStoreId || d.storeLocationId !== scope.storeLocationId) {
      refusedScope.push({
        terminalName: d.terminalName,
        terminalDeviceId: d.terminalDeviceId,
        action: "refused",
        detail: "the delivery names another Store's scope"
      });
    } else {
      inScope.push(d);
    }
  }
  const projected = await withHubTransaction(
    pool,
    async (client) => {
      const self2 = await projectHubSelf(client, input.self, input.primaryVertical);
      const results = [];
      for (const d of inScope) results.push(await projectTerminal(client, d, now));
      const retiredAbsent = await retireAbsentTerminals(
        client,
        scope.storeLocationId,
        inScope.map((d) => d.terminalDeviceId)
      );
      return { self: self2, results, retiredAbsent };
    },
    HUB_RUNTIME_ROLE
  );
  const live = inScope.filter((d) => {
    const r = projected.results.find((x) => x.terminalDeviceId === d.terminalDeviceId);
    return r !== void 0 && r.action !== "refused";
  });
  const desired = desiredGrantSet(live);
  const current = await withHubTransaction(
    pool,
    (client) => readActiveGrantSet(client, scope.storeLocationId),
    HUB_RUNTIME_ROLE
  );
  const held = await withHubTransaction(
    pool,
    (client) => readActiveSections(client, scope.storeLocationId),
    HUB_RUNTIME_ROLE
  );
  const catalog = input.catalog ?? null;
  const money2 = input.money ?? null;
  const because = [];
  if (!grantSetsEqual(desired, current)) because.push("grants");
  if (catalog !== null && held.catalogHash !== catalog.content_hash) because.push("catalog");
  if (money2 !== null && canonicalJson2(held.pricing) !== canonicalJson2(money2)) because.push("money");
  let configuration;
  if (because.length === 0) {
    configuration = { published: false, reason: "unchanged" };
  } else if (desired.size === 0) {
    const withdrawn = await withHubTransaction(
      pool,
      async (client) => {
        const r = await client.query(
          `update edge_config.terminal_profile_assignment
              set effective_until = $2::timestamptz
            where location_id = $1::uuid and enabled and effective_until is null`,
          [scope.storeLocationId, now.toISOString()]
        );
        return r.rowCount ?? 0;
      },
      HUB_RUNTIME_ROLE
    );
    configuration = { published: false, reason: "no_grants", grantsWithdrawn: withdrawn };
  } else {
    const extraSections = [
      ...money2 === null ? [] : [
        {
          sectionCode: "pricing",
          content: money2,
          required: true
        }
      ],
      ...catalog === null ? [] : [
        {
          sectionCode: "catalog",
          content: catalog,
          required: false
        }
      ]
    ];
    const outcome = await publishDevelopmentConfiguration(pool, {
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      locationId: scope.storeLocationId,
      environment: input.environment,
      grants: [...desired].map(([terminalDeviceId, profileCodes]) => ({
        terminalDeviceId,
        profileCodes
      })),
      supersedeOpenGrants: true,
      now,
      extraSections,
      ...input.signer === void 0 ? {} : { signer: input.signer }
    });
    configuration = {
      published: true,
      snapshotVersion: outcome.snapshotVersion,
      grantsWritten: outcome.grantsWritten,
      sections: ["terminal_profiles", ...extraSections.map((x) => x.sectionCode)],
      because
    };
  }
  return {
    hubProjected: true,
    hubIdentityCredential: projected.self.identityCredential,
    terminals: [...projected.results, ...refusedScope],
    retiredAbsent: projected.retiredAbsent,
    configuration
  };
}
async function retireAbsentTerminals(client, locationId, deliveredIds) {
  const { rows } = await client.query(
    `update edge_identity.terminal_device
        set lifecycle_status = 'retired', updated_at = now()
      where location_id = $1::uuid
        and lifecycle_status = 'active'
        and not (id = any($2::uuid[]))
      returning id, terminal_name`,
    [locationId, deliveredIds]
  );
  for (const row of rows) {
    await client.query(
      `update edge_identity.device_credential
          set status = 'superseded'
        where device_id = $1::uuid and status = 'active'`,
      [row.id]
    );
  }
  return rows.map((r) => r.terminal_name);
}

// src/hub/terminal-sync/index.ts
var HUB_SYNC_TRUST_PATH = "/etc/kitluy/hub-sync-trust.json";
var HUB_SYNC_STATE_PATH = "/var/lib/kitluy/hub/terminal-sync.json";
var HUB_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";
var HUB_PAIRING_STATE_PATH = "/var/lib/kitluy/pairing-state.json";
var HUB_BOARD_SERIAL_PATH = "/sys/firmware/devicetree/base/serial-number";
var DEFAULT_SYNC_INTERVAL_SECONDS = 60;
var SYNC_ROUTE = "/hub-sync/v1/terminal-projections";
function terminalSyncConfigFromEnv(env = process.env) {
  const url = (env.HUB_SYNC_URL ?? "").trim();
  if (url === "") return { disabled: "HUB_SYNC_URL is not set" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { disabled: "HUB_SYNC_URL is not a URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { disabled: "HUB_SYNC_URL must be http or https" };
  }
  const interval = Number(env.HUB_SYNC_INTERVAL_SECONDS ?? DEFAULT_SYNC_INTERVAL_SECONDS);
  return {
    config: {
      url: parsed.origin,
      environment: env.KITLUY_ENVIRONMENT ?? "unknown",
      trustPath: env.HUB_SYNC_TRUST_PATH ?? HUB_SYNC_TRUST_PATH,
      statePath: env.HUB_SYNC_STATE_PATH ?? HUB_SYNC_STATE_PATH,
      identityKeyPath: env.HUB_IDENTITY_KEY_PATH ?? HUB_IDENTITY_KEY_PATH,
      pairingStatePath: env.HUB_PAIRING_STATE_PATH ?? HUB_PAIRING_STATE_PATH,
      operationalCertificatePath: env.HUB_TLS_CERT_PATH ?? "/var/lib/kitluy/operational/operational-tls.crt.pem",
      boardSerialPath: env.HUB_BOARD_SERIAL_PATH ?? HUB_BOARD_SERIAL_PATH,
      intervalSeconds: Number.isFinite(interval) && interval >= 10 ? interval : DEFAULT_SYNC_INTERVAL_SECONDS
    }
  };
}
function loadHubSyncTrust(path, environment) {
  if (!existsSync2(path)) return { ok: false, refusal: "TRUST_RECORD_MISSING", detail: path };
  const contents = readFileSync4(path, "utf8");
  if (contents.includes("PRIVATE KEY")) {
    return { ok: false, refusal: "TRUST_RECORD_CARRIES_PRIVATE_KEY", detail: path };
  }
  let raw;
  try {
    raw = JSON.parse(contents);
  } catch (error) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_UNPARSEABLE",
      detail: String(error.message)
    };
  }
  if (raw["kind"] !== HUB_SYNC_TRUST_RECORD_KIND) {
    return { ok: false, refusal: "TRUST_RECORD_WRONG_KIND", detail: `kind=${String(raw["kind"])}` };
  }
  if (raw["purpose"] !== HUB_SYNC_SIGNING_PURPOSE) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_WRONG_PURPOSE",
      detail: `purpose=${String(raw["purpose"])}`
    };
  }
  if (raw["environment"] !== environment) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_WRONG_ENVIRONMENT",
      detail: `record=${String(raw["environment"])}, hub=${environment}`
    };
  }
  const keyId = raw["keyId"];
  const keyVersion = raw["keyVersion"];
  const pem = raw["publicKeyPem"];
  if (typeof keyId !== "string" || typeof pem !== "string" || typeof keyVersion !== "number" || !Number.isInteger(keyVersion) || keyVersion < 1 || raw["algorithm"] !== "ed25519" || raw["state"] !== "current") {
    return {
      ok: false,
      refusal: "TRUST_RECORD_MALFORMED",
      detail: "keyId/keyVersion/publicKeyPem/algorithm/state"
    };
  }
  let publicKey;
  try {
    publicKey = createPublicKey5(pem);
  } catch {
    return { ok: false, refusal: "TRUST_RECORD_MALFORMED", detail: "publicKeyPem does not parse" };
  }
  if (publicKey.asymmetricKeyType !== "ed25519" || publicKeyFingerprint2(pem) !== keyId) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_MALFORMED",
      detail: "keyId is not the key's fingerprint"
    };
  }
  return { ok: true, trust: { keyId, keyVersion, publicKey } };
}
function readBoardFacts(config) {
  if (!existsSync2(config.pairingStatePath))
    return { ok: false, reason: "this Hub has no pairing state; pair it with a Store first" };
  let pairing;
  try {
    pairing = JSON.parse(readFileSync4(config.pairingStatePath, "utf8"));
  } catch {
    return { ok: false, reason: "the pairing state is not valid JSON" };
  }
  if (pairing["phase"] !== "PAIRED")
    return { ok: false, reason: `this Hub is ${String(pairing["phase"])}, not PAIRED` };
  const field = (key) => {
    const v = pairing[key];
    return typeof v === "string" && UUID4.test(v) ? v.toLowerCase() : void 0;
  };
  const hubDeviceId2 = field("deviceRecordId");
  const assignmentId = field("assignmentId");
  const tenantId = field("tenantId");
  const digitalStoreId = field("digitalStoreId");
  const storeLocationId = field("storeLocationId");
  if (!hubDeviceId2 || !assignmentId || !tenantId || !digitalStoreId || !storeLocationId) {
    return {
      ok: false,
      reason: "the pairing state lacks deviceRecordId/assignmentId/tenantId/digitalStoreId/storeLocationId"
    };
  }
  const generationRaw = pairing["assignmentGeneration"];
  const assignmentGeneration = typeof generationRaw === "number" && Number.isInteger(generationRaw) && generationRaw >= 1 ? generationRaw : 1;
  if (!existsSync2(config.identityKeyPath))
    return { ok: false, reason: "no device identity key on this board" };
  let identityPrivateKey;
  try {
    identityPrivateKey = createPrivateKey3(readFileSync4(config.identityKeyPath, "utf8"));
  } catch {
    return { ok: false, reason: "the device identity key does not parse" };
  }
  if (identityPrivateKey.asymmetricKeyType !== "ed25519")
    return { ok: false, reason: "the device identity key is not Ed25519" };
  const identityPublicKeyPem = createPublicKey5(identityPrivateKey).export({ type: "spki", format: "pem" }).toString();
  if (!existsSync2(config.operationalCertificatePath))
    return { ok: false, reason: "this Hub has no operational certificate; it is not activated" };
  const operationalCertificatePem = readFileSync4(config.operationalCertificatePath, "utf8");
  if (!existsSync2(config.boardSerialPath))
    return { ok: false, reason: `cannot read the board serial at ${config.boardSerialPath}` };
  const boardSerial = readFileSync4(config.boardSerialPath).toString("utf8").replace(/\0/gu, "").trim();
  if (boardSerial === "") return { ok: false, reason: "the board serial read back empty" };
  return {
    ok: true,
    facts: {
      self: {
        hubDeviceId: hubDeviceId2,
        assignmentId,
        assignmentGeneration,
        scope: { tenantId, digitalStoreId, storeLocationId },
        boardSerial,
        operationalCertificatePem,
        identityPublicKeyPem
      },
      identityPrivateKey,
      identityPublicKeyPem
    }
  };
}
function buildSyncRequest(facts, now = /* @__PURE__ */ new Date(), nonce = randomBytes5(16).toString("hex")) {
  const requestedAt = now.toISOString();
  const bytes = hubSyncRequestBytes({
    identityPublicKeyFingerprint: publicKeyFingerprint2(facts.identityPublicKeyPem),
    hubDeviceId: facts.hubDeviceId,
    requestedAt,
    nonce
  });
  return {
    kind: HUB_SYNC_REQUEST_KIND,
    hubDeviceId: facts.hubDeviceId,
    identityPublicKeyPem: facts.identityPublicKeyPem,
    requestedAt,
    nonce,
    signature: signBytes(facts.identityPrivateKey, bytes)
  };
}
function verifySyncEnvelope(body, trust, expect, now = /* @__PURE__ */ new Date()) {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const record = body;
  const envelope = record["envelope"];
  const signature = record["signature"];
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  if (signature === null || typeof signature !== "object" || Array.isArray(signature))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const env = envelope;
  const sig = signature;
  if (env["kind"] !== HUB_SYNC_ENVELOPE_KIND) return { ok: false, refusal: "ENVELOPE_WRONG_KIND" };
  if (sig["algorithm"] !== "ed25519" || sig["keyId"] !== trust.keyId || sig["keyVersion"] !== trust.keyVersion) {
    return { ok: false, refusal: "ENVELOPE_UNKNOWN_KEY", detail: `keyId=${String(sig["keyId"])}` };
  }
  const value = sig["value"];
  if (typeof value !== "string" || !SIGNATURE.test(value))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  let bytes;
  try {
    bytes = hubSyncEnvelopeBytes(env);
  } catch {
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  }
  if (!verifyBytes(trust.publicKey, bytes, value))
    return { ok: false, refusal: "ENVELOPE_SIGNATURE_INVALID" };
  const nonce = env["requestNonce"];
  if (typeof nonce !== "string" || !NONCE.test(nonce) || nonce !== expect.nonce) {
    return { ok: false, refusal: "ENVELOPE_NONCE_MISMATCH" };
  }
  const hub = env["hub"];
  if (hub === null || typeof hub !== "object" || Array.isArray(hub))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const h = hub;
  if (typeof h["deviceId"] !== "string" || h["deviceId"].toLowerCase() !== expect.hubDeviceId) {
    return { ok: false, refusal: "ENVELOPE_NOT_FOR_THIS_HUB" };
  }
  const scopeOf = (k) => typeof h[k] === "string" ? h[k].toLowerCase() : "";
  if (scopeOf("tenantId") !== expect.scope.tenantId || scopeOf("digitalStoreId") !== expect.scope.digitalStoreId || scopeOf("storeLocationId") !== expect.scope.storeLocationId) {
    return { ok: false, refusal: "ENVELOPE_WRONG_SCOPE" };
  }
  const cloudVertical = h["primaryVerticalCode"];
  if (typeof cloudVertical !== "string" || cloudVertical.trim().length === 0) {
    return { ok: false, refusal: "ENVELOPE_VERTICAL_MISSING" };
  }
  const primaryVertical = verticalKeyFromCloudCode(cloudVertical.trim());
  if (primaryVertical === null) {
    return {
      ok: false,
      refusal: "ENVELOPE_VERTICAL_UNKNOWN",
      detail: `primaryVerticalCode=${cloudVertical.trim()}`
    };
  }
  const producedAt = env["producedAt"];
  if (typeof producedAt !== "string" || Number.isNaN(Date.parse(producedAt)))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  if (Math.abs(Date.parse(producedAt) - now.getTime()) / 1e3 > REQUEST_MAX_SKEW_SECONDS) {
    return { ok: false, refusal: "ENVELOPE_STALE" };
  }
  const terminals = env["terminals"];
  if (!Array.isArray(terminals)) return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const deliveries = [];
  const malformed = [];
  for (const item of terminals) {
    const parsed = parseTerminalDelivery(item);
    if (parsed.ok) deliveries.push(parsed.delivery);
    else {
      const name = item !== null && typeof item === "object" ? item["terminalName"] : void 0;
      malformed.push(`${typeof name === "string" ? name : "?"}: ${parsed.reason}`);
    }
  }
  const catalog = parseCatalogSection(env["catalog"]);
  if (env["catalog"] !== void 0 && env["catalog"] !== null && catalog === null) {
    return { ok: false, refusal: "ENVELOPE_MALFORMED", detail: "catalog" };
  }
  const money2 = parseMoneySection(env["money"]);
  if (env["money"] !== void 0 && env["money"] !== null && money2 === null) {
    return { ok: false, refusal: "ENVELOPE_MALFORMED", detail: "money" };
  }
  return {
    ok: true,
    envelope: {
      producedAt,
      hubAssetTag: typeof h["assetTag"] === "string" ? h["assetTag"] : "",
      primaryVertical,
      deliveries,
      malformed,
      catalog,
      money: money2
    }
  };
}
function writeState(path, previous, next, success) {
  const state = {
    schema: "kitluy.hub-terminal-sync-state.v1",
    ...next,
    lastSuccessAt: success ? next.lastAttemptAt : previous?.lastSuccessAt ?? null
  };
  try {
    mkdirSync2(dirname2(path), { recursive: true });
    writeFileSync2(path, `${JSON.stringify(state, null, 2)}
`, { mode: 420 });
  } catch {
  }
}
function readState(path) {
  try {
    return JSON.parse(readFileSync4(path, "utf8"));
  } catch {
    return null;
  }
}
async function runTerminalSyncOnce(deps) {
  const now = deps.now ?? (() => /* @__PURE__ */ new Date());
  const { config, log: log2 } = deps;
  const previous = readState(config.statePath);
  const attemptAt = now().toISOString();
  const finish = (outcome2, extra = {}) => {
    writeState(
      config.statePath,
      previous,
      {
        lastAttemptAt: attemptAt,
        outcome: outcome2.kind === "applied" ? "applied" : outcome2.kind === "refused" ? outcome2.code : "unreachable",
        detail: outcome2.kind === "applied" ? null : outcome2.detail ?? null,
        terminals: extra.terminals ?? [],
        configurationVersion: extra.configurationVersion ?? previous?.configurationVersion ?? null
      },
      outcome2.kind === "applied"
    );
    return outcome2;
  };
  if (config.environment !== "development") {
    return finish({
      kind: "refused",
      code: "SYNC_ENVIRONMENT",
      detail: `this Hub declares '${config.environment}'`
    });
  }
  const trust = loadHubSyncTrust(config.trustPath, config.environment);
  if (!trust.ok) return finish({ kind: "refused", code: trust.refusal, detail: trust.detail });
  const board = readBoardFacts(config);
  if (!board.ok) return finish({ kind: "refused", code: "BOARD_NOT_READY", detail: board.reason });
  const request = buildSyncRequest(
    { ...board.facts, hubDeviceId: board.facts.self.hubDeviceId },
    now()
  );
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  let status;
  let body;
  try {
    const response = await fetchImpl(`${config.url}${SYNC_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15e3)
    });
    status = response.status;
    body = await response.json().catch(() => void 0);
  } catch (error) {
    return finish({
      kind: "unreachable",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
  if (status !== 200) {
    const code = body !== null && typeof body === "object" ? String(body["code"] ?? status) : String(status);
    return finish({ kind: "refused", code: `PRODUCER_${code}`, detail: `HTTP ${String(status)}` });
  }
  const verified = verifySyncEnvelope(
    body,
    trust.trust,
    {
      nonce: request.nonce,
      hubDeviceId: board.facts.self.hubDeviceId,
      scope: board.facts.self.scope
    },
    now()
  );
  if (!verified.ok)
    return finish({ kind: "refused", code: verified.refusal, detail: verified.detail });
  let outcome;
  try {
    outcome = await applyEnvelope(deps.pool, {
      self: board.facts.self,
      // From the VERIFIED envelope, never from the board: the Hub's own local
      // state is not an authority on which vertical its Store trades in.
      primaryVertical: verified.envelope.primaryVertical,
      deliveries: verified.envelope.deliveries,
      environment: config.environment,
      now: now(),
      catalog: verified.envelope.catalog,
      money: verified.envelope.money
    });
  } catch (error) {
    return finish({
      kind: "refused",
      code: "APPLY_FAILED",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
  for (const m of verified.envelope.malformed)
    log2.warn?.("terminal sync: a delivery did not parse", { delivery: m });
  const summary = {
    terminals: outcome.terminals.map((t) => ({ name: t.terminalName, action: t.action })),
    configurationVersion: outcome.configuration.published ? outcome.configuration.snapshotVersion : void 0
  };
  return finish(
    {
      kind: "applied",
      outcome,
      hubAssetTag: verified.envelope.hubAssetTag,
      malformed: verified.envelope.malformed
    },
    summary
  );
}
function startTerminalSyncLoop(deps) {
  let stopped = false;
  let timer;
  const { log: log2, config } = deps;
  const tick = async () => {
    if (stopped) return;
    const result = await runTerminalSyncOnce(deps);
    if (result.kind === "applied") {
      const changed = result.outcome.terminals.filter((t) => t.action !== "unchanged");
      const fields = {
        hub: result.hubAssetTag,
        terminals: result.outcome.terminals.length,
        changed: changed.map(
          (t) => `${t.terminalName}:${t.action}${t.retiredPrevious ? "(previous retired)" : ""}${t.detail ? ` ${t.detail}` : ""}`
        ),
        configuration: result.outcome.configuration.published ? `v${result.outcome.configuration.snapshotVersion} (${String(result.outcome.configuration.grantsWritten)} grants; ${result.outcome.configuration.sections.join("+")}; because ${result.outcome.configuration.because.join(",")})` : result.outcome.configuration.reason,
        malformed: result.malformed.length
      };
      if (changed.length > 0 || result.outcome.configuration.published || result.malformed.length > 0) {
        log2.info("terminal sync applied", fields);
      }
    } else if (result.kind === "refused") {
      log2.warn?.("terminal sync refused", {
        code: result.code,
        ...result.detail ? { detail: result.detail } : {}
      });
    } else {
      log2.warn?.("terminal sync: producer unreachable", { detail: result.detail, url: config.url });
    }
    if (!stopped) timer = setTimeout(() => void tick(), config.intervalSeconds * 1e3);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== void 0) clearTimeout(timer);
  };
}

// src/bin/hub-agent.ts
var log = createLogger(SERVICE_NAME);
async function expectedMigrations() {
  const manifestPath = process.env.HUB_MIGRATION_MANIFEST ?? "";
  if (manifestPath === "") return [];
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const record = entry;
      const filename = record.filename;
      const checksum = record.checksumSha256;
      if (typeof filename !== "string" || typeof checksum !== "string") return [];
      return [{ filename, checksumSha256: checksum }];
    });
  } catch {
    return [];
  }
}
async function measureDiskUsedPercent(path) {
  try {
    const { statfs } = await import("node:fs/promises");
    const stats = await statfs(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(total) || total <= 0) return void 0;
    return (total - available) / total * 100;
  } catch {
    return void 0;
  }
}
async function readStoragePosture() {
  const path = process.env.HUB_STORAGE_POSTURE_PATH ?? "/var/lib/kitluy/storage-posture";
  try {
    const { readFile } = await import("node:fs/promises");
    const value = (await readFile(path, "utf8")).trim();
    return value === "OTP-BOUND" || value === "DEVELOPMENT-UNBOUND" ? value : void 0;
  } catch {
    return void 0;
  }
}
async function main() {
  const reachable = await isHubDatabaseReachable();
  const pool = reachable ? createHubPool() : null;
  const hubDeviceId2 = process.env.HUB_DEVICE_ID ?? "";
  let applied = [];
  let clockOffsetSeconds;
  if (pool !== null) {
    const client = await pool.connect();
    try {
      applied = await readAppliedMigrations(client);
      if (hubDeviceId2 !== "") {
        clockOffsetSeconds = await readReportedClockOffsetSeconds(client, hubDeviceId2);
      }
    } finally {
      client.release();
    }
  }
  const dataPath = process.env.HUB_DATA_PATH ?? "/var/lib/kitluy/hub";
  const diskUsedPercent = await measureDiskUsedPercent(dataPath);
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";
  const tls = loadTlsMaterial({
    keyPath: process.env.HUB_TLS_KEY_PATH,
    certPath: process.env.HUB_TLS_CERT_PATH,
    clientCaPath: process.env.HUB_DEVICE_CA_PATH
  });
  const verdict = decideStartup({
    databaseReachable: reachable,
    schema: evaluateSchema(await expectedMigrations(), applied),
    storage: evaluateStoragePosture(await readStoragePosture(), environment),
    tls,
    bind: resolveBindHost(process.env.HUB_LAN_BIND_HOST),
    safety: {
      readOnlyDeclared: process.env.HUB_READ_ONLY === "true",
      // Measured, not assumed. An unmeasured disk falls back to the top of the
      // ladder rather than the bottom: reporting 0% would read as `normal` and
      // silence §13 entirely, whereas a Hub that cannot see its own disk should
      // be treated as being in trouble until it can.
      diskUsedPercent: diskUsedPercent ?? 100,
      migration: { expected: await expectedMigrations(), applied },
      databaseIntegritySuspect: process.env.HUB_DB_INTEGRITY_SUSPECT === "true",
      configuration: { compatible: true, knownGoodActive: true },
      clockOffsetSeconds: clockOffsetSeconds ?? 0
    }
  });
  if (verdict.kind === "refuse") {
    log.info("Store Hub will NOT serve terminals", {
      refusal: verdict.code,
      detail: verdict.detail,
      version: SERVICE_VERSION,
      ...verdict.assessment === void 0 ? {} : { degraded: verdict.assessment.degraded, diskBand: verdict.assessment.diskBand }
    });
    await pool?.end().catch(() => void 0);
    process.exit(0);
  }
  log.info("Store Hub startup checks passed", {
    bindHost: verdict.bindHost,
    port: HUB_LAN_PORT,
    degraded: verdict.assessment.degraded,
    diskBand: verdict.assessment.diskBand,
    // Stated explicitly so nobody reads "no clock anomaly" as a verified fact
    // when it is simply an absent reading.
    clockObservation: clockOffsetSeconds === void 0 ? "unavailable" : "reported",
    diskObservation: diskUsedPercent === void 0 ? "unmeasured" : "measured",
    version: SERVICE_VERSION
  });
  if (tls.kind !== "present") {
    log.info("terminal listener not started", { reason: tls.code, detail: tls.detail });
    await pool?.end().catch(() => void 0);
    return;
  }
  const composition = composeDevelopmentListener({
    environment,
    tlsCertificateFingerprint: certificateFingerprint(tls.cert),
    bindHost: verdict.bindHost
  });
  if (composition.kind === "refused") {
    log.info("terminal listener not started", {
      reason: composition.code,
      detail: composition.detail
    });
    await pool?.end().catch(() => void 0);
    return;
  }
  const listener = await startDevelopmentListener({
    pool,
    composition,
    environment,
    bindHost: verdict.bindHost,
    tls: { key: tls.key, cert: tls.cert, clientCa: tls.clientCa },
    logger: { info: (fields) => log.info("edge", fields) }
  });
  log.info("Store Hub is serving terminals", {
    bindHost: verdict.bindHost,
    port: listener.port,
    // Stated on every start. A development listener must never be mistaken in a
    // log for the production one it is standing in for.
    posture: "DEVELOPMENT-ONLY",
    hubDeviceId: composition.identity.hubDeviceId,
    storeLocationId: composition.identity.storeLocationId
  });
  const syncConfig = terminalSyncConfigFromEnv();
  let stopSync;
  if ("disabled" in syncConfig) {
    log.info("terminal sync not started", { reason: syncConfig.disabled });
  } else {
    stopSync = startTerminalSyncLoop({
      pool,
      config: syncConfig.config,
      log: {
        info: (message, fields) => log.info(message, fields ?? {}),
        warn: (message, fields) => log.warn(message, fields ?? {})
      }
    });
    log.info("terminal sync started", {
      url: syncConfig.config.url,
      intervalSeconds: syncConfig.config.intervalSeconds,
      trust: syncConfig.config.trustPath
    });
  }
  const shutdown = (signal) => {
    log.info("Store Hub is stopping", { signal });
    stopSync?.();
    void listener.close().catch(() => void 0).then(() => pool?.end().catch(() => void 0)).then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
async function publishDevelopmentConfigurationCommand(path) {
  const { readFileSync: readFileSync5 } = await import("node:fs");
  const { publishDevelopmentConfiguration: publishDevelopmentConfiguration2 } = await Promise.resolve().then(() => (init_dev_configuration(), dev_configuration_exports));
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";
  const delivery = JSON.parse(readFileSync5(path, "utf8"));
  const required = ["terminalDeviceId", "tenantId", "digitalStoreId", "storeLocationId"];
  for (const field of required) {
    if (typeof delivery[field] !== "string" || delivery[field] === "") {
      throw new Error(`the delivery has no ${field}`);
    }
  }
  const profileCodes = delivery.profileCodes ?? [];
  if (profileCodes.length === 0) {
    throw new Error(
      "the delivery grants no profiles; the Hub would activate a configuration that permits nothing and every pairing would still be refused"
    );
  }
  const pool = createHubPool();
  try {
    const outcome = await publishDevelopmentConfiguration2(pool, {
      tenantId: delivery.tenantId,
      digitalStoreId: delivery.digitalStoreId,
      locationId: delivery.storeLocationId,
      environment,
      grants: [{ terminalDeviceId: delivery.terminalDeviceId, profileCodes }]
    });
    log.info("development configuration activated", {
      snapshotId: outcome.snapshotId,
      snapshotVersion: outcome.snapshotVersion,
      previousSnapshotId: outcome.previousSnapshotId,
      grantsWritten: outcome.grantsWritten,
      profiles: profileCodes.join(", ")
    });
  } finally {
    await pool.end().catch(() => void 0);
  }
}
async function resetTerminalPinCommand(args) {
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";
  if (environment !== "development") {
    throw new Error(
      `this Hub is '${environment}': a Terminal PIN reset outside development is the Partner Portal's governed action, which needs the cloud-to-Hub delivery (BLK-006)`
    );
  }
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? void 0 : args[index + 1];
  };
  const terminalDeviceId = option("--terminal");
  const operator = option("--operator");
  const reason = option("--reason");
  if (terminalDeviceId === void 0 || operator === void 0 || reason === void 0) {
    throw new Error("usage: reset-terminal-pin --terminal <uuid> --operator <ref> --reason <code>");
  }
  const { randomUUID: randomUUID10 } = await import("node:crypto");
  const { resetTerminalPin: resetTerminalPin2 } = await Promise.resolve().then(() => (init_terminal_pin(), terminal_pin_exports));
  const pool = createHubPool();
  try {
    const outcome = await resetTerminalPin2(pool, {
      terminalDeviceId,
      actorRef: operator,
      reasonCode: reason,
      correlationId: randomUUID10()
    });
    if (outcome.outcome !== "ok") throw new Error(`${outcome.refusal}: ${outcome.detail}`);
    log.info("Terminal PIN reset", {
      result: outcome.result,
      terminalDeviceId,
      state: outcome.value.pin.state,
      sessionsClosed: outcome.value.sessionsClosed
    });
  } finally {
    await pool.end().catch(() => void 0);
  }
}
async function syncTerminalsCommand() {
  const syncConfig = terminalSyncConfigFromEnv();
  if ("disabled" in syncConfig) throw new Error(syncConfig.disabled);
  const pool = createHubPool();
  try {
    const result = await runTerminalSyncOnce({
      pool,
      config: syncConfig.config,
      log: {
        info: (message, fields) => log.info(message, fields ?? {}),
        warn: (message, fields) => log.warn(message, fields ?? {})
      }
    });
    if (result.kind !== "applied") {
      throw new Error(
        `${result.kind === "refused" ? result.code : "PRODUCER_UNREACHABLE"}: ${result.detail ?? ""}`
      );
    }
    log.info("terminal sync applied", {
      hub: result.hubAssetTag,
      terminals: result.outcome.terminals.map(
        (t) => `${t.terminalName}:${t.action}${t.detail ? ` (${t.detail})` : ""}`
      ),
      configuration: result.outcome.configuration.published ? `v${result.outcome.configuration.snapshotVersion} (${String(result.outcome.configuration.grantsWritten)} grants; ${result.outcome.configuration.sections.join("+")}; because ${result.outcome.configuration.because.join(",")})` : result.outcome.configuration.reason,
      malformed: result.malformed
    });
  } finally {
    await pool.end().catch(() => void 0);
  }
}
var subcommand = process.argv[2];
if (subcommand === "sync-terminals") {
  syncTerminalsCommand().catch((error) => {
    log.error("terminal sync did NOT apply", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
} else if (subcommand === "reset-terminal-pin") {
  resetTerminalPinCommand(process.argv.slice(3)).catch((error) => {
    log.error("Terminal PIN reset was REFUSED", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
} else if (subcommand === "publish-development-configuration") {
  const path = process.argv[3];
  if (path === void 0) {
    log.error("publish-development-configuration needs the delivery file path");
    process.exit(2);
  }
  publishDevelopmentConfigurationCommand(path).catch((error) => {
    log.error("development configuration was REFUSED", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
} else {
  main().catch((error) => {
    log.error("Store Hub agent failed to start", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
}
/*! Bundled license information:

hash-wasm/dist/index.umd.js:
  (*!
   * hash-wasm (https://www.npmjs.com/package/hash-wasm)
   * (c) Dani Biro
   * @license MIT
   *)
*/
