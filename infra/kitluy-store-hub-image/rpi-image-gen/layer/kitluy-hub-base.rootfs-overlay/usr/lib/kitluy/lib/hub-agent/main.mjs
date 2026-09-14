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
    var escapeIdentifier2 = function(str) {
      return '"' + str.replace(/"/g, '""') + '"';
    };
    var escapeLiteral2 = function(str) {
      let hasBackslash = false;
      let escaped = "'";
      if (str == null) {
        return "''";
      }
      if (typeof str !== "string") {
        return "''";
      }
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
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
      randomBytes: randomBytes3,
      deriveKey,
      sha256,
      hashByName,
      hmacSha256,
      md5
    };
    var webCrypto = nodeCrypto.webcrypto || globalThis.crypto;
    var subtleCrypto = webCrypto.subtle;
    var textEncoder = new TextEncoder();
    function randomBytes3(length) {
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
    function parse(str, options = {}) {
      if (str.charAt(0) === "/") {
        const config2 = str.split(" ");
        return { host: config2[0], database: config2[1] };
      }
      const config = /* @__PURE__ */ Object.create(null);
      let result;
      let dummyHost = false;
      if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str)) {
        str = encodeURI(str).replace(/%25(\d\d)/g, "%$1");
      }
      try {
        try {
          result = new URL(str, "postgres://base");
        } catch (e) {
          result = new URL(str.replace("@/", "@___DUMMY___/"), "postgres://base");
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
    function parseIntoClientConfig(str) {
      return toClientConfig(parse(str));
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
    var add = function(params, config, paramName) {
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
        add(params, this, "user");
        add(params, this, "password");
        add(params, this, "port");
        add(params, this, "application_name");
        add(params, this, "fallback_application_name");
        add(params, this, "connect_timeout");
        add(params, this, "options");
        const ssl = typeof this.ssl === "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
        add(params, ssl, "sslmode");
        add(params, ssl, "sslca");
        add(params, ssl, "sslkey");
        add(params, ssl, "sslcert");
        add(params, ssl, "sslrootcert");
        add(params, this, "sslnegotiation");
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
        const self = this;
        this.on("newListener", function(eventName) {
          if (eventName === "message") {
            self._emitMessage = true;
          }
        });
      }
      connect(port, host) {
        const self = this;
        this._connecting = true;
        this.stream.setNoDelay(true);
        this.stream.connect(port, host);
        this.stream.once("connect", function() {
          if (self._keepAlive) {
            self.stream.setKeepAlive(true, self._keepAliveInitialDelayMillis);
          }
          self.emit("connect");
        });
        const reportStreamError = function(error) {
          if (self._ending && (error.code === "ECONNRESET" || error.code === "EPIPE")) {
            return;
          }
          self.emit("error", error);
        };
        this.stream.on("error", reportStreamError);
        this.stream.on("close", function() {
          self.emit("end");
        });
        if (!this.ssl) {
          return this.attachListeners(this.stream);
        }
        if (this.sslNegotiation === "direct") {
          return this.stream.once("connect", function() {
            self.upgradeToSSL(host, reportStreamError);
          });
        }
        this.stream.once("data", function(buffer) {
          const responseCode = buffer.toString("utf8");
          switch (responseCode) {
            case "S":
              break;
            case "N":
              self.stream.end();
              return self.emit("error", new Error("The server does not support SSL connections"));
            default:
              self.stream.end();
              return self.emit("error", new Error("There was an error establishing an SSL connection"));
          }
          self.upgradeToSSL(host, reportStreamError);
        });
      }
      upgradeToSSL(host, reportStreamError) {
        const self = this;
        const options = {
          socket: self.stream
        };
        if (self.ssl !== true) {
          Object.assign(options, self.ssl);
          if ("key" in self.ssl) {
            options.key = self.ssl.key;
          }
        }
        if (self.sslNegotiation === "direct") {
          options.ALPNProtocols = ["postgresql"];
        }
        const net = __require("net");
        if (net.isIP && net.isIP(host) === 0) {
          options.servername = host;
        }
        try {
          self.stream = stream.getSecureStream(options);
        } catch (err) {
          return self.emit("error", err);
        }
        self.attachListeners(self.stream);
        self.stream.on("error", reportStreamError);
        self.emit("sslconnect");
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
    function push(self, val) {
      if (val !== void 0) {
        self.push(val);
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
        const self = this;
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
          if (self.ssl) {
            if (self.sslNegotiation !== "direct") {
              con.requestSsl();
            }
          } else {
            con.startup(self.getStartupConf());
          }
        });
        con.on("sslconnect", function() {
          con.startup(self.getStartupConf());
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
      escapeIdentifier(str) {
        return utils.escapeIdentifier(str);
      }
      escapeLiteral(str) {
        return utils.escapeLiteral(str);
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
      const self = this;
      this.native = client.native;
      client.native.arrayMode = this._arrayMode;
      let after = function(err, rows, results) {
        client.native.arrayMode = false;
        setImmediate(function() {
          self.emit("_done");
        });
        if (err) {
          return self.handleError(err);
        }
        if (self._emitRowEvents) {
          if (results.length > 1) {
            rows.forEach((rowOfRows, i) => {
              rowOfRows.forEach((row) => {
                self.emit("row", row, results[i]);
              });
            });
          } else {
            rows.forEach(function(row) {
              self.emit("row", row, results);
            });
          }
        }
        self.state = "end";
        self.emit("end", results);
        if (self.callback) {
          self.callback(null, results);
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
          client.namedQueries[self.name] = self.text;
          return self.native.execute(self.name, values, after);
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
      const self = this;
      if (this._connecting) {
        process.nextTick(() => cb(new Error("Client has already been connected. You cannot reuse a client.")));
        return;
      }
      this._connecting = true;
      this.connectionParameters.getLibpqConnectionString(function(err, conString) {
        if (self.connectionParameters.nativeConnectionString) conString = self.connectionParameters.nativeConnectionString;
        if (err) return cb(err);
        self.native.connect(conString, function(err2) {
          if (err2) {
            self.native.end();
            return cb(err2);
          }
          self._connected = true;
          self.native.on("error", function(err3) {
            self._queryable = false;
            self._errorAllQueries(err3);
            self.emit("error", err3);
          });
          self.native.on("notification", function(msg) {
            self.emit("notification", {
              channel: msg.relname,
              payload: msg.extra
            });
          });
          self.emit("connect");
          self._pulseQueryQueue(true);
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
      const self = this;
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
        self._connected = false;
        self._errorAllQueries(new Error("Connection terminated"));
        process.nextTick(() => {
          self.emit("end");
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
      const self = this;
      query.once("_done", function() {
        self._pulseQueryQueue();
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
var HUB_DB_URL_ENV, UUID_PATTERN, CANONICAL_IDEMPOTENCY_KEY_REGEX;
var init_hub_database = __esm({
  "src/hub-database.ts"() {
    "use strict";
    HUB_DB_URL_ENV = "KITLUY_HUB_DB_URL";
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

// ../../packages/device-identity/dist/environments.js
var init_environments = __esm({
  "../../packages/device-identity/dist/environments.js"() {
    "use strict";
  }
});

// ../../packages/device-identity/dist/errors.js
var PKI_BLOCKER_REF, RequiredCryptographicValueError;
var init_errors = __esm({
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

// ../../packages/device-identity/dist/dev-crypto.js
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { createHash as createHash2, randomUUID } from "node:crypto";
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
    init_errors();
    sha256Hex = (data) => createHash2("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex");
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

// src/hub/sync/errors.ts
var SYNC_TRANSIENT_ERROR_CODES, SYNC_DURABLE_REJECTION_CODES, TRANSIENT, DURABLE, SyncDeliveryError;
var init_errors2 = __esm({
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
import { createHash as createHash8 } from "node:crypto";
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
    sections: [...snapshot.sections].map((s) => ({
      section_code: s.sectionCode,
      section_version: s.sectionVersion.toString(),
      required: s.required,
      content_sha256: sectionDigest(s)
    })).sort((a, b) => a.section_code < b.section_code ? -1 : 1)
  });
}
function sectionDigest(section) {
  return createHash8("sha256").update(canonicalJson(section.content), "utf8").digest("hex");
}
function snapshotManifestSha256(snapshot) {
  return createHash8("sha256").update(snapshotManifest(snapshot), "utf8").digest("hex");
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
    init_errors2();
  }
});

// src/hub/sync/signing.ts
import { createHmac, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var DEV_MIN_SIGNING_KEY_BYTES, DevelopmentHmacBatchSigner;
var init_signing = __esm({
  "src/hub/sync/signing.ts"() {
    "use strict";
    init_errors2();
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
import { randomBytes as randomBytes2, randomUUID as randomUUID8 } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function loadOrCreateDevelopmentSigner(path = DEV_CONFIGURATION_KEY_PATH) {
  let secret;
  try {
    secret = Buffer.from(readFileSync3(path, "utf8").trim(), "base64");
  } catch {
    secret = randomBytes2(32);
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
      const unsigned = {
        snapshotId: randomUUID8(),
        tenantId: input.tenantId,
        digitalStoreId: input.digitalStoreId,
        locationId: input.locationId,
        snapshotVersion,
        schemaVersion: 1,
        notBefore: now,
        expiresAt: null,
        minimumHubVersion: "0.1.0",
        maximumHubVersion: null,
        sections: [section]
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
        activationId: randomUUID8(),
        snapshotId: snapshot.snapshotId,
        actorType: "service",
        healthCheck: { source: "development-configuration-publisher" }
      });
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
    init_esm();
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

// src/hub/repositories/audit.ts
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

// src/hub/errors.ts
var HubCommandError = class extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
    this.name = "HubCommandError";
  }
};

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
var WS09_DELIVERY_STATE = "pending";
var WS09_WIRE_SYNC_STATE = "pending_cloud_sync";
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
async function readReportedClockOffsetSeconds(client, hubDeviceId) {
  const result = await client.query(
    `select details_json ->> 'ntp_offset_seconds' as offset_seconds
       from edge_hardware.device_heartbeat
      where device_id = $1 and details_json ? 'ntp_offset_seconds'
      order by observed_at desc
      limit 1`,
    [hubDeviceId]
  );
  const raw = result.rows[0]?.offset_seconds;
  if (raw === null || raw === void 0) return void 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : void 0;
}

// src/hub-runtime.ts
import { createHash } from "node:crypto";
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
  return createHash("sha256").update(Buffer.from(body, "base64")).digest("hex");
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
import { createHash as createHash7, createPrivateKey as createPrivateKey2, createPublicKey as createPublicKey2, sign as cryptoSign } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";

// src/hub/pairing.ts
import { randomUUID as randomUUID2, randomBytes } from "node:crypto";

// ../../packages/device-identity/dist/index.js
init_environments();
init_errors();
init_errors();

// ../../packages/device-identity/dist/trusted-time.js
init_errors();
var MAX_REVOCATION_SNAPSHOT_AGE_HOURS = {
  development: 30 * 24,
  pilot: 14 * 24,
  production: 14 * 24
};

// ../../packages/device-identity/dist/certificate-validity.js
init_dev_crypto();

// ../../packages/device-identity/dist/certificate-renewal.js
var MS_PER_DAY = 1e3 * 60 * 60 * 24;

// ../../packages/device-identity/dist/revocation-snapshot.js
var MS_PER_HOUR = 1e3 * 60 * 60;

// ../../packages/device-identity/dist/index.js
init_dev_crypto();

// ../../packages/device-identity/dist/certificate-issuance.js
init_errors();
init_dev_crypto();

// ../../packages/device-identity/dist/issuance-adapter.js
init_dev_crypto();

// ../../packages/device-identity/dist/replacement-key-pop.js
init_dev_crypto();

// ../../packages/device-identity/dist/provisioning-pop.js
init_dev_crypto();

// ../../packages/device-identity/dist/activation-ack.js
init_dev_crypto();

// ../../packages/device-identity/dist/pairing.js
init_dev_crypto();
import { createHash as createHash3 } from "node:crypto";
var PAIRING_PROTOCOL_VERSION = "1.0";
var PAIRING_PURPOSE = "hub_terminal_pairing";
var PAIRING_TERMINAL_PROOF_KIND = "kitluy.pairing-terminal-proof.v1";
var PAIRING_HUB_PROOF_KIND = "kitluy.pairing-hub-proof.v1";
var PAIRING_RECEIPT_KIND = "kitluy.pairing-receipt.v1";
var PAIRING_TRANSCRIPT_KIND = "kitluy.pairing-transcript.v1";
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
  return createHash3("sha256").update(Buffer.from(pairingTranscriptBytes(t))).digest("hex");
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

// ../../packages/device-identity/dist/same-key-renewal-preflight.js
init_dev_crypto();

// ../../packages/device-identity/dist/same-key-renewal-issuance.js
init_dev_crypto();

// ../../packages/device-identity/dist/replacement-key-provider.js
init_errors();
init_dev_crypto();

// ../../packages/device-identity/dist/rotate-key-renewal-issuance.js
init_dev_crypto();

// ../../packages/device-identity/dist/credential-lifecycle-jobs.js
var DEVICE_JOB_MAX_ATTEMPTS = 5;

// ../../packages/device-identity/dist/credential-revocation.js
var COMPROMISE_REASONS = [
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
var COMPROMISE_REASON_SET = new Set(COMPROMISE_REASONS);

// ../../packages/device-identity/dist/key-destruction.js
var MAX_DESTRUCTION_EXECUTION_ATTEMPTS = 5;

// ../../packages/device-identity/dist/revocation-and-destruction-jobs.js
init_environments();
var DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS = Math.min(DEVICE_JOB_MAX_ATTEMPTS, MAX_DESTRUCTION_EXECUTION_ATTEMPTS);
var DEVICE_REVOCATION_JOB_FAILURE_CODES = {
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
function completed(resultCode) {
  return { kind: "completed", resultCode };
}
function failed(failureCode) {
  return { kind: "failed", failureCode };
}
var REVOCATION_OUTCOME_ROUTING = {
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
var REVOCATION_OUTCOME_INDEX = new Map(Object.entries(REVOCATION_OUTCOME_ROUTING));
var REVOCATION_REFUSAL_ROUTING = {
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
var REVOCATION_REFUSAL_INDEX = new Map(Object.entries(REVOCATION_REFUSAL_ROUTING));
var KEY_DESTRUCTION_OUTCOME_ROUTING = {
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
var KEY_DESTRUCTION_OUTCOME_INDEX = new Map(Object.entries(KEY_DESTRUCTION_OUTCOME_ROUTING));
var RECOVERY_DISPOSITION_ROUTING = {
  NO_RECOVERY: completed("NO_ACTION_REQUIRED"),
  RECOVERY_REQUIRED: completed("RECOVERY_REQUIRED"),
  REPROVISION_REQUIRED: completed("REPROVISION_REQUIRED"),
  REASSIGNMENT_REQUIRED: completed("REASSIGNMENT_REQUIRED"),
  MANUAL_SECURITY_REVIEW: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_MANUAL_REVIEW)
};
var RECOVERY_DISPOSITION_INDEX = new Map(Object.entries(RECOVERY_DISPOSITION_ROUTING));
var DESTRUCTION_REQUEST_STATUS_ROUTING = {
  executed: completed("JOB_RESULT_REPLAYED"),
  requested: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  approved: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  pending_execution: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  failed: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  manual_review: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  cancelled: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  expired: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED)
};
var DESTRUCTION_REQUEST_STATUS_INDEX = new Map(Object.entries(DESTRUCTION_REQUEST_STATUS_ROUTING));

// ../../packages/device-identity/dist/edge-discovery.js
init_dev_crypto();
var EDGE_DISCOVERY_KIND = "kitluy.edge-discovery.v1";
var EDGE_DISCOVERY_SERVICE_TYPE = "_kitluy-edge._tcp.local";
var EDGE_DISCOVERY_REFRESH_SECONDS = 30;
var EDGE_DISCOVERY_VALIDITY_SECONDS = 90;
var EDGE_LAN_PORT = 7443;
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

// ../../packages/device-identity/dist/manufacturing-enrollment-pop.js
init_dev_crypto();

// ../../packages/device-identity/dist/terminal-configuration-delivery.js
init_dev_crypto();
var TERMINAL_CONFIGURATION_DELIVERY_KIND = "kitluy.terminal-configuration-delivery.v1";
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

// ../../packages/device-identity/dist/credential-package.js
init_dev_crypto();

// ../../packages/device-identity/dist/device-registration-request.js
init_dev_crypto();

// src/hub/pairing.ts
init_db();

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

// ../../packages/shared-types/dist/index.js
var asId = {
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

// src/hub/outbox.ts
import { createHash as createHash4 } from "node:crypto";
init_hub_database();
function sha256Hex2(input) {
  return createHash4("sha256").update(input, "utf8").digest("hex");
}
function payloadChecksum(payload) {
  return sha256Hex2(canonicalJson(payload));
}

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
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HEX64 = /^[0-9a-f]{64}$/;
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
    if (!UUID.test(input.terminalDeviceId) || !PROFILE.test(input.requestedProfileCode) || !HEX64.test(input.terminalNonce)) {
      this.logger.info({ operation: "preparePairing", correlationId, result: "REQUEST_INVALID" });
      return { result: "REQUEST_INVALID", correlationId };
    }
    const sessionId = randomUUID2();
    const hubNonce = randomBytes(32).toString("hex");
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
    if (!UUID.test(input.pairingSessionId) || input.signatureBase64.length === 0 || input.signatureBase64.length > MAX_SIGNATURE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(input.signatureBase64) || !input.terminalPublicKeyPem.includes("BEGIN PUBLIC KEY")) {
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
    if (!UUID.test(input.pairingSessionId)) {
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
    if (!UUID.test(input.pairingSessionId)) {
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
import { randomUUID as randomUUID7 } from "node:crypto";
init_db();

// src/hub/terminal-health.ts
import { randomUUID as randomUUID4 } from "node:crypto";
init_db();
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

// src/hub/edge/runtime-bootstrap.ts
import { createHash as createHash5, randomUUID as randomUUID5, scryptSync, timingSafeEqual } from "node:crypto";
init_db();
init_hub_database();
var RUNTIME_PROTOCOL_VERSION = "1.0";
var AUTHORITY_TIME_MAX_CACHE_AGE_SECONDS = 30;
var DEV_STAFF_SESSION_LIFETIME_MINUTES = 30;
var T1_PROFILE_CODE = "laundry.t1.intake_cashier";
var PERMISSION_STAFF_SESSIONS_OPEN = "staff.sessions.open";
var PERMISSION_STAFF_SESSIONS_READ = "staff.sessions.read";
var PERMISSION_STAFF_SESSIONS_REFRESH = "staff.sessions.refresh";
var PERMISSION_STAFF_SESSIONS_CLOSE = "staff.sessions.close";
var PERMISSION_POS_T1_USE = "pos.t1.use";
var PERMISSION_CUSTOMERS_READ = "customers.read";
var PERMISSION_CUSTOMERS_CREATE = "customers.create";
var PERMISSION_CONSENT_RECORD = "customers.consent.record";
var PERMISSION_BOOKINGS_READ = "laundry.bookings.read";
var PERMISSION_BOOKINGS_CREATE = "laundry.bookings.create";
async function readAuthorityTime(pool) {
  const instant = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query(`select now() as now`);
      const row = result.rows[0];
      if (row === void 0) throw new Error("the Hub database returned no transaction time");
      return row.now;
    },
    HUB_RUNTIME_ROLE
  );
  const iso = instant.toISOString();
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
async function deriveEligibility(client, terminalDeviceId, certificateSerial, environment) {
  const refuse = (refusal2, detail) => ({
    outcome: "refused",
    refusal: refusal2,
    detail
  });
  const hub = await client.query(
    `select id, lifecycle_status, trust_status
       from edge_identity.hub_device
      where device_kind = 'store_hub'
      order by created_at
      limit 1`
  );
  const hubRow = hub.rows[0];
  if (hubRow === void 0) {
    return refuse("HUB_NOT_OPERATIONAL", "no Store Hub device record exists");
  }
  if (hubRow.lifecycle_status === "retired") {
    return refuse("HUB_RETIRED", "this Store Hub is retired");
  }
  if (hubRow.trust_status !== "trusted" || hubRow.lifecycle_status !== "deployed") {
    return refuse("HUB_NOT_OPERATIONAL", "this Store Hub is not trusted and deployed");
  }
  const replacement = await client.query(
    `select mode from edge_identity.hub_replacement_state where singleton = true`
  );
  const mode = replacement.rows[0]?.mode ?? "normal";
  if (mode !== "normal") {
    return mode === "retired_rejected" ? refuse("HUB_RETIRED", "this Store Hub is locally retired") : refuse("HUB_REPLACEMENT_BLOCKED", `hub replacement state is ${mode}`);
  }
  const hubAssignment = await client.query(
    `select hub_device_id, tenant_id, digital_store_id, location_id, assignment_generation
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
  const terminal = await client.query(
    `select tenant_id, digital_store_id, location_id, assignment_generation, lifecycle_status
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
      order by paired_at desc
      limit 1`,
    [terminalDeviceId]
  );
  const receiptRow = receipt.rows[0];
  if (receiptRow === void 0) {
    return refuse("PAIRING_REQUIRED", "no pairing receipt exists for this terminal");
  }
  if (receiptRow.terminal_assignment_generation !== terminalRow.assignment_generation) {
    return refuse(
      "ASSIGNMENT_GENERATION_STALE",
      "the pairing receipt binds a superseded assignment generation"
    );
  }
  const grant = await client.query(
    `select tpa.id, tpa.profile_code
       from edge_config.terminal_profile_assignment tpa
       join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
      where tpa.terminal_device_id = $1::uuid
        and tpa.enabled
        and tpa.effective_from <= now()
        and (tpa.effective_until is null or tpa.effective_until > now())
        and cs.state = 'active'
      order by tpa.assignment_version desc
      limit 1`,
    [terminalDeviceId]
  );
  const grantRow = grant.rows[0];
  if (grantRow === void 0) {
    return refuse("PROFILE_NOT_GRANTED", "no enabled profile assignment exists");
  }
  if (grantRow.profile_code !== T1_PROFILE_CODE) {
    return refuse("PROFILE_NOT_T1", `the assigned profile is ${grantRow.profile_code}`);
  }
  if (receiptRow.terminal_profile_code !== grantRow.profile_code) {
    return refuse("ASSIGNMENT_GENERATION_STALE", "the pairing receipt binds another profile");
  }
  const containment = await client.query(
    `select directive from edge_identity.effective_containment where device_uuid = $1::uuid`,
    [terminalDeviceId]
  );
  const directive = containment.rows[0]?.directive ?? "none";
  if (directive === "operations_restricted" || directive === "suspended" || directive === "quarantined") {
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
      credentialId: credentialRow.id,
      credentialGeneration: credentialRow.rotation_generation,
      credentialEligibility: "eligible",
      activationEligibility: "activated",
      pairingEligibility: "paired",
      pairedAt: receiptRow.paired_at.toISOString(),
      containmentState,
      hubReplacementState: mode,
      requiredConfigurationVersion: requiredVersion === void 0 ? null : Number(requiredVersion),
      authorityTime: authorityTime.toISOString()
    }
  };
}
var DEV_DELIVERY_VALIDITY_HOURS = 24;
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
      const payloadSha256 = createHash5("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex");
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
            opened_at, expires_at, closed_at, session_generation
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

// src/hub/t1-intake.ts
import { createHash as createHash6, randomUUID as randomUUID6 } from "node:crypto";
init_db();
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
  return createHash6("sha256").update(Buffer.from(value, "utf8")).digest("hex");
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
    event_id: randomUUID6(),
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
      const customerId = randomUUID6();
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
            randomUUID6(),
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
  const receiptId = randomUUID6();
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
      const draftId = randomUUID6();
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
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HEX642 = /^[0-9a-f]{64}$/;
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
var EDGE_CUSTOMERS_SEARCH_PATH = "/edge/v1/customers/search";
var EDGE_CUSTOMERS_PATH = "/edge/v1/customers";
var EDGE_BOOKING_DRAFTS_PATH = "/edge/v1/laundry/bookings/drafts";
var MAX_INTAKE_BODY_BYTES = 8 * 1024;
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
  SESSION_CLOSED: "RESOURCE_VERSION_CONFLICT"
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
  if (clean === EDGE_CUSTOMERS_SEARCH_PATH) {
    return method === "GET" ? { route: "customers-search" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_CUSTOMERS_PATH) {
    return method === "POST" ? { route: "customers-create" } : "METHOD_NOT_ALLOWED";
  }
  const customer = /^\/edge\/v1\/customers\/([^/]+)(?:\/(consent-decisions))?$/.exec(clean);
  if (customer !== null) {
    const customerId = customer[1] ?? "";
    if (!UUID2.test(customerId)) return null;
    if (customer[2] === "consent-decisions") {
      return method === "POST" ? { route: "customers-consent", customerId } : "METHOD_NOT_ALLOWED";
    }
    return method === "GET" ? { route: "customers-read", customerId } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_BOOKING_DRAFTS_PATH) {
    return method === "POST" ? { route: "drafts-create" } : "METHOD_NOT_ALLOWED";
  }
  const draft = /^\/edge\/v1\/laundry\/bookings\/drafts\/([^/]+)(?:\/(cancel))?$/.exec(clean);
  if (draft !== null) {
    const draftId = draft[1] ?? "";
    if (!UUID2.test(draftId)) return null;
    if (draft[2] === "cancel") {
      return method === "POST" ? { route: "drafts-cancel", draftId } : "METHOD_NOT_ALLOWED";
    }
    if (method === "GET") return { route: "drafts-read", draftId };
    if (method === "PATCH") return { route: "drafts-update", draftId };
    return "METHOD_NOT_ALLOWED";
  }
  const sub = /^\/edge\/v1\/terminal-pairing\/sessions\/([^/]+)\/(terminal-proof|complete|receipt)$/.exec(
    clean
  );
  if (sub !== null) {
    const sessionId = sub[1] ?? "";
    if (!UUID2.test(sessionId)) return null;
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
      const correlationId = randomUUID7();
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
        // T002: every intake route refuses query strings EXCEPT the search
        // read, whose single bounded `phone` parameter is parsed explicitly.
        "customers-create",
        "customers-read",
        "customers-consent",
        "drafts-create",
        "drafts-read",
        "drafts-update",
        "drafts-cancel"
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
            const actorId = requireShaped(body, "actorId", UUID2);
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
            const sessionId = requireShaped(body, "sessionId", UUID2);
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
  const terminalAssignmentId = requireShaped(body, "terminalAssignmentId", UUID2);
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
  const activationChallengeId = requireShaped(body, "activationChallengeId", UUID2);
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
  const terminalNonce = requireShaped(body, "terminalNonce", HEX642);
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
async function handleT1Intake(deps, terminal, matched, request, body, queryString, correlationId) {
  if (!terminal.activated) return refusal("ACTIVATION_REQUIRED", correlationId);
  if (Buffer.byteLength(request.rawBody ?? "", "utf8") > MAX_INTAKE_BODY_BYTES) {
    return invalid(correlationId, "the request body exceeds the intake bound");
  }
  const sessionHeader = request.headers[INTAKE_SESSION_HEADER];
  const sessionId = typeof sessionHeader === "string" ? sessionHeader : "";
  if (!UUID2.test(sessionId)) {
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
        const customerId = walkIn ? null : requireShaped(intakeBody, "customerId", UUID2);
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
async function serve(req, res, handler, logger) {
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
    const response = await handler.handle({
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
  const hubDeviceId = stringField(credential, "deviceRecordId");
  const tenantId = stringField(pairing, "tenantId");
  const digitalStoreId = stringField(pairing, "digitalStoreId");
  const storeLocationId = stringField(pairing, "storeLocationId");
  const missing = [];
  if (certificateSerial === void 0) missing.push("certificateSerial");
  if (hubDeviceId === void 0) missing.push("deviceRecordId");
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
    const signingCredentialSerial = createHash7("sha256").update(createPublicKey2(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
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
      hubDeviceId,
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
  const handler = createEdgeTerminalRouter({
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
    handler,
    ...options.logger === void 0 ? {} : { logger: options.logger }
  });
  const { port } = await server.listen();
  return { port, close: () => server.close() };
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
  const hubDeviceId = process.env.HUB_DEVICE_ID ?? "";
  let applied = [];
  let clockOffsetSeconds;
  if (pool !== null) {
    const client = await pool.connect();
    try {
      applied = await readAppliedMigrations(client);
      if (hubDeviceId !== "") {
        clockOffsetSeconds = await readReportedClockOffsetSeconds(client, hubDeviceId);
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
  const shutdown = (signal) => {
    log.info("Store Hub is stopping", { signal });
    void listener.close().catch(() => void 0).then(() => pool?.end().catch(() => void 0)).then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
async function publishDevelopmentConfigurationCommand(path) {
  const { readFileSync: readFileSync4 } = await import("node:fs");
  const { publishDevelopmentConfiguration: publishDevelopmentConfiguration2 } = await Promise.resolve().then(() => (init_dev_configuration(), dev_configuration_exports));
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";
  const delivery = JSON.parse(readFileSync4(path, "utf8"));
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
      grants: [
        { terminalDeviceId: delivery.terminalDeviceId, profileCodes }
      ]
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
var subcommand = process.argv[2];
if (subcommand === "publish-development-configuration") {
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
