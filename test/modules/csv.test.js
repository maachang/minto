// modules/csv/ (csvReader, csvWriter, jsonb, memoryTable) のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCsvReader, readCsv } = require("../../modules/csv/csvReader.js");
const { createCsvWriter } = require("../../modules/csv/csvWriter.js");
const jsonb = require("../../modules/csv/jsonb.js");
const memoryTable = require("../../modules/csv/memoryTable.js");

// ---- csvReader ----

test("csvReader: readCsv はヘッダーと行データを文字列で返す", () => {
    const csv = "name,age,active\nAlice,30,true\nBob,25,false";
    const result = readCsv(csv);
    assert.deepEqual(result.headers, ["name", "age", "active"]);
    assert.deepEqual(result.rows[0], { name: "Alice", age: "30", active: "true" });
    assert.deepEqual(result.rows[1], { name: "Bob", age: "25", active: "false" });
});

test("csvReader: createCsvReader は型変換付きで1行ずつ取得できる", () => {
    const csv = "id,name,price\n1,Apple,120\n2,Banana,80";
    const reader = createCsvReader(csv);
    const rows = [];
    while (reader.hasNext()) {
        const row = reader.next();
        rows.push([row.getNumber("id"), row.getString("name"), row.getNumber("price")]);
    }
    assert.deepEqual(rows, [[1, "Apple", 120], [2, "Banana", 80]]);
});

test("csvReader: ダブルクォート内のカンマ・改行を無視して解析する", () => {
    const csv = 'name,comment\nAlice,"Hello, World"\nBob,"line1\nline2"';
    const result = readCsv(csv);
    assert.equal(result.rows[0].comment, "Hello, World");
    assert.equal(result.rows[1].comment, "line1\nline2");
});

// ---- csvWriter ----

test("csvWriter: put/next でCSV文字列を組み立てる", () => {
    const writer = createCsvWriter(["id", "name", "price"]);
    writer.put("id", 1).put("name", "Apple").put("price", 120).next();
    writer.put("id", 2).put("name", "Banana").put("price", 80).next();
    assert.equal(writer.getWriteCsv(), "id,name,price\n1,Apple,120\n2,Banana,80\n");
});

test("csvWriter: ダブルクォート・カンマを含む値は自動エスケープされる", () => {
    const writer = createCsvWriter(["name", "comment"]);
    writer.put("name", "Alice").put("comment", 'He said, "Hi"').next();
    assert.equal(writer.getWriteCsv(),
        'name,comment\nAlice,"He said, ""Hi"""\n');
});

test("csvWriter: 未定義カラムへのputはエラーになる", () => {
    const writer = createCsvWriter(["id", "name"]);
    assert.throws(() => writer.put("unknown", 1));
});

// ---- jsonb ----

test("jsonb: encode/decode で元のオブジェクトを復元できる", () => {
    const original = {
        name: "Alice",
        age: 30,
        scores: [95, 80, 72],
        active: true
    };
    const bin = jsonb.encode(original);
    assert.equal(bin instanceof Uint8Array, true);
    const restored = jsonb.decode(bin);
    assert.deepEqual(restored, original);
});

test("jsonb: null/undefinedはnullとして扱われる", () => {
    const bin = jsonb.encode({ a: null, b: undefined });
    const restored = jsonb.decode(bin);
    assert.equal(restored.a, null);
    assert.equal(restored.b, null);
});

// ---- memoryTable ----

test("memoryTable: insert/select/find で検索・ソートができる", () => {
    const tbl = memoryTable.create("id", "name", "dept", "age");
    tbl.setColumnTypes("id", "number", "age", "number");
    tbl.insertList([
        { id: 1, name: "Alice", dept: "Sales", age: 28 },
        { id: 2, name: "Bob", dept: "Dev", age: 35 },
        { id: 3, name: "Carol", dept: "Sales", age: 42 }
    ]);
    assert.equal(tbl.count(), 3);

    const result = tbl.select(
        tbl.find().eq("dept", "Sales").ge("age", 30),
        "age", true
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Carol");
});

test("memoryTable: update/delete が反映される", () => {
    const tbl = memoryTable.create("id", "name", "age");
    tbl.setColumnTypes("id", "number", "age", "number");
    tbl.insertList([
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 20 }
    ]);

    tbl.update(tbl.find().eq("name", "Bob"), { age: 21 });
    assert.equal(tbl.select(tbl.find().eq("name", "Bob"))[0].age, 21);

    tbl.delete(tbl.find().eq("id", 1));
    assert.equal(tbl.count(), 1);
});

test("memoryTable: save/openで保存・復元できる", () => {
    const tbl = memoryTable.create("id", "name");
    tbl.setColumnTypes("id", "number");
    tbl.insert({ id: 1, name: "Alice" });

    const saved = JSON.parse(JSON.stringify(tbl.save(true)));
    const restored = memoryTable.open(saved);
    assert.equal(restored.count(), 1);
    assert.equal(restored.row(0).name, "Alice");
});
