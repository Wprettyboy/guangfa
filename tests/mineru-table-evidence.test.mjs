import assert from "node:assert/strict";
import test from "node:test";
import { findMinerUTableHtml, parseMinerUTableHtml, stripMinerUTableHtml } from "../server/knowledge/mineru-tables.js";

const tableHtml = `<table><tr><td><strong>编号</strong></td><td><strong>模块</strong></td><td><strong>功能</strong></td></tr><tr><td>1</td><td rowspan="2"><p>食堂</p></td><td>餐标配置</td></tr><tr><td>2</td><td><p>预约限额</p><p>支持按餐次限制人数。</p></td></tr></table>`;

test("MinerU table evidence preserves merged cells and line breaks", () => {
  const table = parseMinerUTableHtml(tableHtml);
  assert.equal(table.columnCount, 3);
  assert.equal(table.header[0].text, "编号");
  assert.equal(table.rows[0][1].rowSpan, 2);
  assert.equal(table.rows[1][1].text, "预约限额\n支持按餐次限制人数。");
});

test("MinerU table lookup requires exact normalized source text", () => {
  const sourceText = stripMinerUTableHtml(tableHtml);
  assert.equal(findMinerUTableHtml([{ type: "table", table_body: tableHtml }], sourceText), tableHtml);
  assert.equal(findMinerUTableHtml([{ type: "table", table_body: tableHtml }], `${sourceText} 额外字符`), "");
});
