// Run: node --test scripts/test-dynamic-dashboard-field-values.mjs
// Exercises actual browser aggregation functions against deterministic permission-filtered rows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../src/LFPortal.Web/wwwroot/js/dynamic-dashboard.js",import.meta.url),"utf8");
const valuesStart=source.indexOf("  function valuesFor(row,id) {");
const valuesEnd=source.indexOf("  function number(value) {",valuesStart);
const groupStart=source.indexOf("  function groupKey(id,value) {");
const groupEnd=source.indexOf("  function details(title,docs) {",groupStart);
assert.ok(valuesStart>=0 && valuesEnd>valuesStart && groupStart>=0 && groupEnd>groupStart,
  "The actual aggregation functions must be present in the bundled script");

const implementation=source.slice(valuesStart,valuesEnd)+"\n"+source.slice(groupStart,groupEnd);
const make=new Function("seedRows",[
  'const EMPTY_VALUE="\\u0000no-value";',
  'const unique=values=>[...new Set(values.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(String))];',
  'const dateStamp=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time):null;};',
  'let rows=seedRows;',
  implementation,
  'return {observedValues,selectedRows,summary};'
].join("\n"));
const rows=[
  {id:1,template:"Contracts",fields:{"123":["High","Medium"]},created:"2026-01-11T12:00:00Z"},
  {id:2,template:"Invoices",fields:{"123":["High","High"]},created:"2026-01-12T12:00:00Z"},
  {id:3,template:"Contracts",fields:{},created:"2026-02-12T12:00:00Z"}
];
const engine=make(rows);
const chart=(dimension,selectedValues=[],type="bar")=>({dimension,selectedValues,type});

test("field options reflect document metadata with distinct counts",()=>{
  const vals=engine.observedValues("123");
  assert.equal(vals.find(v=>v.value==="High").count,2);
  assert.equal(vals.find(v=>v.value==="Medium").count,1);
  assert.equal(vals.find(v=>v.label==="بدون قيمة").count,1);
  assert.equal(vals.filter(v=>v.value==="Low").length,0);
});

test("multi-value fields count each document once per matching category",()=>{
  const output=engine.summary(chart("123"));
  assert.equal(output.groups.find(v=>v.label==="High").value,2);
  assert.equal(output.groups.find(v=>v.label==="Medium").value,1);
  assert.equal(output.items.length,3);
});

test("multiple selected values count distinct documents in KPI",()=>{
  const output=engine.summary(chart("123",["High","Medium"],"kpi"));
  assert.equal(output.kpi,2);
  assert.deepEqual(output.items.map(v=>v.id),[1,2]);
});

test("chart selections do not affect unrelated charts",()=>{
  assert.equal(engine.summary(chart("123",["Medium"],"kpi")).kpi,1);
  assert.equal(engine.summary(chart("__template",[],"kpi")).kpi,3);
  assert.equal(engine.summary(chart("__template",["Invoices"],"kpi")).kpi,1);
});

test("created-date groups are derived from actual documents",()=>{
  const result=engine.observedValues("__created");
  assert.equal(result.find(v=>v.value==="2026-01").count,2);
  assert.equal(result.find(v=>v.value==="2026-02").count,1);
});

test("unavailable saved values cannot broaden results",()=>{
  assert.equal(engine.summary(chart("123",["Removed value"],"kpi")).kpi,0);
});
