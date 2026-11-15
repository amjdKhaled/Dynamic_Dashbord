import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script=readFileSync(new URL("../src/LFPortal.Web/wwwroot/js/dynamic-dashboard.js",import.meta.url),"utf8");
const dropPlacement=new Function("desktopColumns",
  script.slice(script.indexOf("  function dropPlacement("),script.indexOf("  function applyDesktopDrop("))+
  "\nreturn dropPlacement;")(10);
const slot=(row,column,width)=>({row,column,width});

test("a wide widget swaps into the target row and packs displaced widgets into its old row",()=>{
  const positions=new Map([
    ["a",slot(0,0,2)],["b",slot(0,2,2)],["c",slot(0,4,2)],["d",slot(0,6,2)],["e",slot(0,8,2)],
    ["unrelated",slot(1,0,5)],["source",slot(2,0,6)],["peer",slot(2,6,4)]
  ]);
  const {next,placed,insertedRow,displaced}=dropPlacement(positions,"source","a");
  assert.deepEqual(displaced,["a","b","c"]);
  assert.deepEqual(placed,slot(0,0,6));
  for(const [i,id] of ["a","b","c"].entries())assert.deepEqual(next.get(id),slot(2,i*2,2));
  assert.deepEqual(next.get("peer"),slot(2,6,4));
  assert.deepEqual(next.get("unrelated"),positions.get("unrelated"));
  assert.equal(insertedRow,null);
});

test("displaced widgets that do not fit create a packed row without overlaps",()=>{
  const positions=new Map([
    ["a",slot(0,0,5)],["b",slot(0,5,5)],["source",slot(1,0,6)],["peer",slot(1,6,4)],
    ["after",slot(2,0,10)]
  ]);
  const {next,addedRows}=dropPlacement(positions,"source","a");
  assert.equal(addedRows,1);
  assert.deepEqual(next.get("a"),slot(1,0,5));
  assert.deepEqual(next.get("b"),slot(1,5,5));
  assert.deepEqual(next.get("peer"),slot(2,0,4));
  assert.deepEqual(next.get("after"),slot(3,0,10));
});

test("same-row swap keeps intervening widgets in order and closes gaps",()=>{
  const positions=new Map([["a",slot(0,0,2)],["b",slot(0,3,2)],["c",slot(0,6,4)]]);
  const {next}=dropPlacement(positions,"a","c");
  assert.deepEqual(next.get("c"),slot(0,0,4));
  assert.deepEqual(next.get("b"),slot(0,4,2));
  assert.deepEqual(next.get("a"),slot(0,6,2));
});
