"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { enrichRows, isSaso } = require("../src/LFPortal.Web/wwwroot/js/saso-logical-fields.js");

const catalog = [
  { id:"101", name:"إجراء الوثيقة", type:"List", multi:false },
  { id:"205", name:"إجراء الوثيقة", type:"List", multi:false },
  { id:"900", name:"Subject", type:"Text", multi:false }
];

test("recognizes only the base SASO template and its six colored variants", () => {
  for (const name of ["SASO","SASO (1)","SASO (6)","saso 2","SASO 6"])
    assert.equal(isSaso(name),true,name);
  for (const name of ["SASO 7","SASO old","Other SASO","SA SO"])
    assert.equal(isSaso(name),false,name);
});

test("base SASO status filter includes red documents using another physical field ID", () => {
  const rows = [
    { id:1, template:"SASO", originalTemplate:"SASO", fields:{"101":["معتمدة"]} },
    { id:2, template:"SASO", originalTemplate:"SASO (6)", fields:{"205":["مرفوضة"]} },
    { id:3, template:"Other", originalTemplate:"Other", fields:{"205":["مرفوضة"]} }
  ];
  const original = structuredClone(rows);
  const result = enrichRows(rows,catalog);

  assert.equal(result.aliasCount,2); // copied 101->205 and 205->101
  assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(rows,original); // original dashboard/API data is immutable
  assert.deepEqual(result.rows.filter(row=>
    row.template==="SASO" && (row.fields?.["101"] ?? []).includes("مرفوضة")
  ).map(row=>row.id),[2]);
  assert.deepEqual(result.rows[1].fields["205"],["مرفوضة"]);
  assert.deepEqual(result.rows[2],rows[2]); // unrelated templates stay untouched
});

test("same physical Field ID needs no aliases", () => {
  const rows=[
    {id:1,template:"SASO",originalTemplate:"SASO",fields:{"101":["معتمدة"]}},
    {id:2,template:"SASO",originalTemplate:"SASO (3)",fields:{"101":["مرفوضة"]}}
  ];
  const result=enrichRows(rows,catalog);
  assert.equal(result.aliasCount,0);
  assert.deepEqual(result.rows,rows);
});

test("different field types are never merged", () => {
  const rows=[
    {id:1,template:"SASO",originalTemplate:"SASO",fields:{"101":["معتمدة"]}},
    {id:2,template:"SASO",originalTemplate:"SASO (3)",fields:{"205":["مرفوضة"]}}
  ];
  const mixed=[catalog[0],{...catalog[1],type:"Date"}];
  const result=enrichRows(rows,mixed);
  assert.deepEqual(result.rows,rows);
  assert.equal(result.aliasCount,0);
  assert.ok(result.conflicts.includes("SASO · إجراء الوثيقة"));
});

test("same-name fields with multiple IDs within one physical template do not merge", () => {
  const rows=[
    {id:1,template:"SASO",originalTemplate:"SASO",fields:{"101":["مرفوضة"]}},
    {id:2,template:"SASO",originalTemplate:"SASO",fields:{"205":["معتمدة"]}},
    {id:3,template:"SASO",originalTemplate:"SASO (6)",fields:{"205":["مرفوضة"]}}
  ];
  const result=enrichRows(rows,catalog);
  assert.deepEqual(result.rows,rows);
  assert.ok(result.conflicts.includes("SASO · إجراء الوثيقة"));
});

test("missing unreadable fields are never invented", () => {
  const rows=[
    {id:1,template:"SASO",originalTemplate:"SASO",fields:null},
    {id:2,template:"SASO",originalTemplate:"SASO (6)",fields:{"205":["مرفوضة"]}},
    {id:3,template:"SASO",originalTemplate:"SASO (2)",fields:{"101":["معتمدة"]}}
  ];
  const result=enrichRows(rows,catalog);
  assert.equal(result.rows[0].fields,null);
  assert.deepEqual(result.rows[1].fields["101"],["مرفوضة"]);
});

test("unknown or incompatible field schemas fail closed", () => {
  const rows=[
    {id:1,template:"SASO",originalTemplate:"SASO",fields:{"101":["معتمدة"]}},
    {id:2,template:"SASO",originalTemplate:"SASO (6)",fields:{"205":["مرفوضة"]}}
  ];
  const unknown=[catalog[0],{...catalog[1],type:null}];
  const result=enrichRows(rows,unknown);
  assert.equal(result.aliasCount,0);
  assert.ok(result.conflicts.includes("SASO · إجراء الوثيقة"));
});


test("empty alternate IDs do not hide values from another colored template", () => {
  const rows=[
    {id:1,template:"SASO",originalTemplate:"SASO",fields:{"101":["معتمدة"],"205":[]}},
    {id:2,template:"SASO",originalTemplate:"SASO (6)",fields:{"101":[],"205":["مرفوضة"]}}
  ];
  const result=enrichRows(rows,catalog);
  assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(result.rows[1].fields["101"],["مرفوضة"]);
  assert.deepEqual(result.aliasesByTemplate.SASO,[["101","205"]]);
  assert.deepEqual(rows[1].fields["101"],[]);
});

test("configured groups combine only their own field values", () => {
  const groups=[
    {name:"Contracts",templates:["Green contract","Red contract"]},
    {name:"Requests",templates:["Green request","Red request"]}
  ];
  const rows=[
    {id:1,template:"Contracts",originalTemplate:"Green contract",fields:{"101":["Accepted"]}},
    {id:2,template:"Contracts",originalTemplate:"Red contract",fields:{"205":["Rejected"]}},
    {id:3,template:"Requests",originalTemplate:"Green request",fields:{"101":["Pending"]}},
    {id:4,template:"Other",originalTemplate:"Other",fields:{"205":["Other"]}}
  ];
  const result=enrichRows(rows,catalog,groups);
  assert.deepEqual(result.rows[1].fields["101"],["Rejected"]);
  assert.equal(result.rows[2].fields["205"],undefined);
  assert.equal(result.rows[3].fields["101"],undefined);
  assert.equal(result.rows.length,rows.length);
  assert.equal(require("../src/LFPortal.Web/wwwroot/js/saso-logical-fields.js").groupName("Red contract",groups),"Contracts");
});
