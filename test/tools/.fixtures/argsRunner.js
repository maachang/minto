// tools/args.js のテスト用ランナー.
// 実際のCLI起動と同じ形で process.argv を解釈させ、
// 各APIの結果をJSONで標準出力に返す.
const args = require("../../../tools/args.js");

console.log(JSON.stringify({
    get_t: args.get("-t", "--target"),
    next0_i: args.next(0, "-i"),
    next1_i: args.next(1, "-i"),
    next2_i: args.next(2, "-i"),
    getArray_i: args.getArray("-i"),
    isValue_h: args.isValue("-h", "--help"),
    isValue_x: args.isValue("-x"),
    getFirst: args.getFirst(),
    getLast: args.getLast(),
    length: args.length(),
    getBoolean_all: args.getBoolean("-all", "--all"),
}));
