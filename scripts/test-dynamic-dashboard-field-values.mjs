// Run: node --test scripts/test-dynamic-dashboard-field-values.mjs
// Exercises actual browser aggregation functions against deterministic permission-filtered rows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../src/LFPortal.Web/wwwroot/js/dynamic-dashboard.js",import.meta.url),"utf8");
const valuesStart=source.indexOf("  function valuesFor(row,id) {");
const valuesEnd=source.indexOf("  function number(value) {",valuesStart);
const groupStart=source.indexOf("  function groupKey(id,value) {");
const utilitiesStart=source.indexOf("  const isRecent =");
const utilitiesEnd=source.indexOf("  const tablePages",utilitiesStart);
const dayStart=source.indexOf("  function dayKey");
const groupEnd=source.indexOf("  function openArchive(title, docs) {",groupStart);
assert.ok(valuesStart>=0 && valuesEnd>valuesStart && groupStart>=0 && groupEnd>groupStart,
  "The actual aggregation functions must be present in the bundled script");

const documentStart=source.indexOf("  function dateColumnsLimited(");
const documentEnd=source.indexOf("  function drawTable(",documentStart);
const implementation=source.slice(valuesStart,valuesEnd)+"\n"+source.slice(utilitiesStart,utilitiesEnd)
  +source.slice(dayStart,groupEnd)+source.slice(documentStart,documentEnd);
const make=new Function("seedRows",[
  'const EMPTY_VALUE="\\u0000no-value";',
  'const unique=values=>[...new Set(values.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(String))];',
  'const dateStamp=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time):null;};',
  'let rows=seedRows;',
  implementation,
  'return {observedValues,selectedRows,summary,pageCount,displayType,documentRows};'
].join("\n"));
const rows=[
  {id:1,template:"Contracts",fields:{"123":["High","Medium"]},created:"2026-01-11T12:00:00",modified:"2026-02-01T00:00:00",pages:0},
  {id:2,template:"Invoices",fields:{"123":["High","High"]},created:"2026-01-12T12:00:00",modified:"2026-02-03T23:59:59",pages:3},
  {id:3,template:"Contracts",fields:{},created:"2026-02-12T12:00:00",modified:"2026-02-12T12:00:00",pages:null}
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

test("select all includes every category and supports individual exclusions",()=>{
  const config={...chart("123"),allValues:true};
  assert.equal(engine.summary(config).groups.length,3);
  config.selectedValues=["High"];
  const result=engine.summary(config);
  assert.deepEqual(result.items.map(row=>row.id),[1,3]);
  assert.ok(!result.groups.some(group=>group.label==="High"));
});

test("modification date filter includes both selected days",()=>{
  const config={...chart("__modified"),from:"2026-02-01",to:"2026-02-03"};
  assert.deepEqual(engine.summary(config).items.map(row=>row.id),[1,2]);
  assert.deepEqual(engine.summary({...config,from:"",to:"2026-02-01"}).items.map(row=>row.id),[1]);
  assert.deepEqual(engine.documentRows(config).map(row=>row.id),[2,1]);
  assert.deepEqual(engine.documentRows({...config,from:"2026-02-12",to:""}),[]);
  assert.deepEqual(engine.documentRows({...chart("__created"),from:"2026-02-12",to:"2026-02-12"}).map(row=>row.id),[3]);
});

test("exact page counts accept zero but distinguish missing and reject invalid inputs",()=>{
  assert.equal(engine.pageCount("0"),0);
  assert.equal(engine.pageCount("٣٫٠"),3);
  assert.equal(engine.pageCount("2.5"),2.5);
  assert.deepEqual(engine.summary({...chart("__pages"),pages:2.5}).items,[]);
  for(const value of ["","-1","2147483648","test"])assert.equal(engine.pageCount(value),null);
  assert.deepEqual(engine.summary({...chart("__pages"),pages:0}).items.map(row=>row.id),[1]);
  assert.deepEqual(engine.summary({...chart("__pages"),pages:3}).items.map(row=>row.id),[2]);
  assert.deepEqual(engine.summary({...chart("__pages"),pages:7}).items,[]);
});

test("the ten-document column limit applies only to creation and modification date ranges",()=>{
  const documents=Array.from({length:11},(_,id)=>({id,template:"Contracts",
    created:"2026-02-01T12:00:00",modified:id===10?"2026-02-03T12:00:00":"2026-02-02T12:00:00"}));
  const dashboard=make(documents);
  assert.equal(dashboard.displayType(chart("__template")),"bar");
  assert.equal(dashboard.displayType(chart("__template",[],"horizontal")),"horizontal");
  assert.equal(dashboard.displayType(chart("__created")),"documents");
  assert.equal(dashboard.displayType({...chart("__modified"),to:"2026-02-02"}),"bar");
  assert.equal(dashboard.displayType(chart("__modified",[],"horizontal")),"documents");
  assert.equal(engine.displayType(chart("__modified",[],"table")),"documents");
  assert.equal(engine.displayType(chart("__modified",[],"line")),"line");
});
