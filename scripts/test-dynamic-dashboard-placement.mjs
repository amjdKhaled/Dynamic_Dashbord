import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script=readFileSync(new URL("../src/LFPortal.Web/wwwroot/js/dynamic-dashboard.js",import.meta.url),"utf8");
const {dropPlacement,emptyPlacement}=new Function("desktopColumns",
  script.slice(script.indexOf("  function emptyPlacement("),script.indexOf("  function bindCardDrag("))+
  script.slice(script.indexOf("  function swapIntoSourceRow("),script.indexOf("  function planCardSwap("))+
  "\nreturn {dropPlacement,emptyPlacement};")(10);
const slot=(row,column,width)=>({row,column,width});
const cardWidth=()=>2;

test("a wide widget swaps into the target row and packs displaced widgets into its old row",()=>{
  const positions=new Map([
    ["a",slot(0,0,2)],["b",slot(0,2,2)],["c",slot(0,4,2)],["d",slot(0,6,2)],["e",slot(0,8,2)],
    ["unrelated",slot(1,0,5)],["source",slot(2,0,6)],["peer",slot(2,6,4)]
  ]);
  const {next,placed,insertedRow,displaced}=dropPlacement(positions,"source","a",cardWidth);
  assert.deepEqual(displaced,["a","b","c"]);
  assert.deepEqual(placed,slot(0,0,6));
  for(const [i,id] of ["a","b","c"].entries())assert.deepEqual(next.get(id),slot(2,i*2,2));
  assert.deepEqual(next.get("peer"),slot(2,6,4));
  assert.deepEqual(next.get("unrelated"),positions.get("unrelated"));
  assert.equal(insertedRow,null);
});

test("a five-column chart takes two cards without moving the neighboring doughnut",()=>{
  const positions=new Map([
    ["a",slot(0,0,2)],["b",slot(0,2,2)],["c",slot(0,4,2)],["d",slot(0,6,2)],["e",slot(0,8,2)],
    ["source",slot(1,0,5)],["doughnut",slot(1,5,5)]
  ]);
  const {next,placed,displaced}=dropPlacement(positions,"source","a",id=>id==="source"?3:2);
  assert.deepEqual(placed,slot(0,0,4));
  assert.deepEqual(displaced,["a","b"]);
  assert.deepEqual(next.get("a"),slot(1,0,2));
  assert.deepEqual(next.get("b"),slot(1,2,2));
  for(const id of ["c","d","e","doughnut"])assert.deepEqual(next.get(id),positions.get(id));
});

test("dropping toward the end of a row uses a contiguous block on the other side",()=>{
  const positions=new Map([["a",slot(0,6,2)],["b",slot(0,8,2)],["source",slot(1,0,4)]]);
  const {next,displaced}=dropPlacement(positions,"source","b",cardWidth);
  assert.deepEqual(displaced,["a","b"]);
  assert.deepEqual(next.get("source"),slot(0,6,4));
});

test("different-width cards fit into one another's slots without moving intervening widgets",()=>{
  const positions=new Map([["a",slot(0,0,3)],["b",slot(0,3,2)],["c",slot(0,5,5)]]);
  const {next}=dropPlacement(positions,"a","c",id=>id==="b"?2:3);
  assert.deepEqual(next.get("c"),slot(0,0,3));
  assert.deepEqual(next.get("b"),positions.get("b"));
  assert.deepEqual(next.get("a"),slot(0,5,3));
});

test("a KPI swaps with a wider chart using two top-row slots",()=>{
  const positions=new Map([
    ["a",slot(0,0,2)],["peer",slot(0,2,2)],["other",slot(0,4,2)],
    ["chart",slot(1,0,5)],["doughnut",slot(1,5,5)]
  ]);
  const {next,placed,insertedRow}=dropPlacement(positions,"a","chart",id=>id==="chart"?3:2);
  assert.deepEqual(placed,slot(1,0,2));
  assert.deepEqual(next.get("chart"),slot(0,0,4));
  assert.deepEqual(next.get("peer"),slot(1,2,2));
  for(const id of ["other","doughnut"])assert.deepEqual(next.get(id),positions.get(id));
  assert.equal(insertedRow,null);
});

test("a chart moves up into free columns without displacing extra cards",()=>{
  const positions=new Map([
    ["a",slot(0,0,2)],["other",slot(0,4,2)],["chart",slot(1,0,5)],["doughnut",slot(1,5,5)]
  ]);
  const {next,placed,insertedRow}=dropPlacement(positions,"a","chart",id=>id==="chart"?3:2);
  assert.deepEqual(placed,slot(1,0,2));
  assert.deepEqual(next.get("chart"),slot(0,0,4));
  for(const id of ["other","doughnut"])assert.deepEqual(next.get(id),positions.get(id));
  assert.equal(insertedRow,null);
});

test("a KPI can move below a table when neither row has sufficient width",()=>{
  const positions=new Map([
    ["a",slot(0,0,2)],["b",slot(0,2,2)],["c",slot(0,4,2)],["d",slot(0,6,2)],["e",slot(0,8,2)],["table-left",slot(1,0,5)],["table-right",slot(1,5,5)],["following",slot(2,0,5)]
  ]);
  const {next,placed,insertedRow,addedRows}=dropPlacement(positions,"a","table-left",id=>id==="a"?2:5);
  assert.deepEqual(placed,slot(2,0,2));
  assert.deepEqual(next.get("table-left"),positions.get("table-left"));
  assert.deepEqual(next.get("table-right"),positions.get("table-right"));
  assert.deepEqual(next.get("following"),slot(3,0,5));
  assert.equal(insertedRow,2);
  assert.equal(addedRows,1);
});

test("dropping into an empty slot preserves the coordinates of every other card",()=>{
  const positions=new Map([["a",slot(0,0,5)],["peer",slot(0,5,5)],["table",slot(1,0,5)]]);
  const {next,resize}=emptyPlacement(positions,"a",slot(1,7,3));
  assert.deepEqual(next.get("a"),slot(1,7,3));
  assert.deepEqual(next.get("peer"),positions.get("peer"));
  assert.deepEqual(next.get("table"),positions.get("table"));
  assert.equal(resize,true);
});
