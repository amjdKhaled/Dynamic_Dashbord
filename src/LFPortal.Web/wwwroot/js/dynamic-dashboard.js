/* Dynamic Dashboard: no remote dependencies, no fabricated repository data. */
(() => {
  "use strict";
  const root = document.getElementById("dynamicDashboard");
  if (!root) return;
  const arabic = root.dataset.language === "ar";
  const locale = arabic ? "ar-SA" : "en";
  const T = (ar,en) => arabic ? ar : en;
  const $ = id => document.getElementById(id);
  const requestHeaders = {"X-Dashboard-Repository":root.dataset.repository,"X-Dashboard-Layout-Scope":root.dataset.scope,"X-Requested-With":"XMLHttpRequest"};
  const BUILTIN = [
    {id:"__template",name:T("القالب","Template"),type:"list"},
    {id:"__creator",name:T("المستخدم / المنشئ","User / creator"),type:"list"},
    {id:"__created",name:T("تاريخ الإضافة","Date added"),type:"date"},
    {id:"__modified",name:T("تاريخ التعديل","Date modified"),type:"date"},
    {id:"__folder",name:T("المجلد","Folder"),type:"list"},
    {id:"__pages",name:T("عدد الصفحات","Page count"),type:"number"}
  ];
  const palette = ["#0d3850","#60a2c4","#bf972c","#156083","#2b795b","#9eb0c1","#dcb455"];
  const defaults = [
    {id:"base-docs",title:T("إجمالي الوثائق الظاهرة","Total visible documents"),type:"kpi",dimension:"__template",wide:false,hidden:false,selectedValues:[]},
    {id:"base-templates",title:T("توزيع الوثائق حسب القالب","Documents by template"),type:"doughnut",dimension:"__template",wide:false,hidden:false,selectedValues:[]},
    {id:"base-months",title:T("الوثائق حسب تاريخ الإضافة","Documents by date added"),type:"line",dimension:"__created",wide:true,hidden:false,selectedValues:[]},
    {id:"base-users",title:T("الوثائق حسب المستخدم","Documents by user"),type:"bar",dimension:"__creator",wide:false,hidden:false,selectedValues:[]},
    {id:"base-recent-created",title:T("المستندات المنشأة حديثًا","Recently created documents"),type:"recent-created",wide:true},
    {id:"base-recent-modified",title:T("نشاط المستندات الأخير","Recent document activity"),type:"recent-modified",wide:true}
  ];
  const presetTitles = new Map([
    ["إجمالي الوثائق الظاهرة", "Total visible documents"],
    ["توزيع الوثائق حسب القالب", "Documents by template"],
    ["الوثائق حسب تاريخ الإضافة", "Documents by date added"],
    ["الوثائق حسب المستخدم", "Documents by user"],
    ["المستندات المنشأة حديثًا", "Recently created documents"],
    ["نشاط المستندات الأخير", "Recent document activity"],
    ["اللوحة الرئيسية", "Main dashboard"]
  ]);
  const presetTitle = value => {
    for (const [ar,en] of presetTitles) if (value === ar || value === en) return T(ar,en);
    return value;
  };
  // Keep the original repository-backed widget and its drill-down behavior available as a display type.
  const overview = new Map();
  const overviewStorage = $("dd-main-overview");
  const overviewRoot = overviewStorage.querySelector("#dashboard-overview");
  const overviewDefinitions = [
    ["folders-total","إجمالي المجلدات","Total folders",3,"__folder"],
    ["docs-total","إجمالي المستندات","Total documents",3,"__template"],
    ["templates-total","إجمالي القوالب","Total templates",3,"__template"],
    ["with-template","مستندات بقالب","Documents with template",3,"__template"],
    ["without-template","مستندات بدون قالب","Documents without template",3,"__template"],
    ["folders","المستندات حسب المجلد","Documents by folder",6,"__folder"],
    ["templates","توزيع القوالب","Template distribution",6,"__template"],
    ["activity","نشاط المستندات","Document activity",6,"__created"],
    ["users","نشاط المستخدمين","User activity",6,"__creator"],
    ["template-stats","إحصاءات القوالب","Template statistics",12,"__template"],
    ["doc-types","توزيع أنواع المستندات","Document type distribution",6,"__template"],
    ["health","حالة النظام","System health",6,"__template"],
    ["recent-created","المستندات المنشأة حديثًا","Recently created documents",12,"__created"],
    ["recent-modified","نشاط المستندات الأخير","Recent document activity",12,"__modified"]
  ];
  for (const [key,ar,en,span,dimension] of overviewDefinitions) {
    const node=overviewRoot.querySelector('[data-overview-id="'+key+'"]');
    const label=node?.querySelector(".d-card-title,.d-kpi-lbl,.folder-kpi-label");
    overview.set("overview-"+key,{node,label,title:label?.textContent.trim()||T(ar,en),span,dimension});
  }
  const overviewAlert=overviewRoot.querySelector(".d-alert");
  const widgetTitle = chart => chart.title || overview.get(chart.id)?.title || T("مؤشر","Widget");
  const EMPTY_VALUE = "\u0000no-value";
  const validTypes = ["bar","horizontal","line","doughnut","pie","table","documents","kpi","recent-created","recent-modified","overview"];
  const isRecent = type => type==="recent-created" || type==="recent-modified";
  const isTable = type => type==="table" || type==="documents" || isRecent(type);
  const dateColumn = chart => chart.type==="overview" ? null : chart.type==="recent-modified" || (!isRecent(chart.type) && chart.dimension==="__modified")
    ? "modified" : chart.type==="recent-created" || chart.dimension==="__created" ? "created" : null;
  const isBar = type => type==="bar" || type==="horizontal";
  function pageCount(value) {
    const decimal = String(value ?? "").trim()
      .replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660))
      .replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x6f0))
      .replace(/[٫,]/g,".");
    return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(decimal) && Number(decimal)<=2147483647
      ? Number(decimal) : null;
  }
  const validDate = value => typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dateStamp(value)?.toISOString().slice(0,10)===value;
  const tablePages = new Map();
  let rows = [], fields = [], charts = [], instances = [], editing = null;
  const boards = new Map();
  const mainBoard = {id:"default",name:T("اللوحة الرئيسية","Main dashboard"),layout:null};
  let activeBoard = {...mainBoard};
  let partial = false, busy = false, editMode = false, revision = 0, savedRevision = 0, saving = false, hasSaved = false, layoutReady = false;

  const quarterWidth = chart => chart.type==="kpi" || (chart.type==="overview" && overview.get(chart.id)?.span===3);

  function cardSpan(chart) {
    if(chart.span==null)return chart.wide || isTable(chart.type)?12:quarterWidth(chart)?3:6;
    // Keep saved half/full widths; only number cards can occupy a quarter row.
    if(quarterWidth(chart) && Number(chart.span)===3)return 3;
    return Number(chart.span)>=9?12:6;
  }

  function normalChart(chart) {
    const oldName = chart.dimension==="__name";
    const type = chart.type==="audit" ? "recent-modified" : chart.type;
    const title = chart.type==="audit" ? T("نشاط المستندات الأخير","Recent document activity") : String(chart.title ?? (overview.has(chart.id)?"":T("مؤشر","Widget")));
    return {
      id:String(chart.id), title:title.replace(/^شارت(?= جديد$| بدون عنوان$|$)/,T("مؤشر","Widget")).slice(0,90),
      type:validTypes.includes(type) && (type!=="overview" || chart.id.startsWith("overview-"))?type:"bar",
      dimension:oldName?"__template":String(chart.dimension||"__template"),
      span:cardSpan({...chart,type}),
      from:validDate(chart.from)?chart.from:"",
      to:validDate(chart.to)?chart.to:"",
      pages:pageCount(chart.pages),
      hidden:Boolean(chart.hidden),
      allValues:Boolean(chart.allValues),
      selectedValues:!oldName && Array.isArray(chart.selectedValues)
        ? [...new Set(chart.selectedValues.filter(v=>typeof v==="string"))].slice(0,500) : []
    };
  }
  function loadConfig(config) {
    if (config && Array.isArray(config.charts)) {
      charts = config.charts.filter(c=>c && typeof c.id==="string").slice(0,80).map(normalChart);
      hasSaved=true;
      if(config.version!==2 && config.version!==3 && activeBoard.id!=="default") {
        for(const card of defaults.filter(item=>isRecent(item.type))) {
          if(charts.length<60 && !charts.some(item=>item.type===card.type))
            charts.push(normalChart(card));
        }
      }
    } else charts=activeBoard.id==="default"?[]:defaults.map(normalChart);
    if(activeBoard.id==="default" && config?.version!==3) {
      const originalCards=[...overview].map(([id, item])=>
        normalChart({id,title:"",type:"overview",dimension:item.dimension,span:item.span}));
      charts=[...originalCards,...charts].slice(0,80);
    }
  }
  function updateSaveBar(message) {
    $("dd-save-layout").disabled=!layoutReady || saving || revision===savedRevision;
    for(const id of ["dd-board-list","dd-new-board","dd-rename-board"])
      $(id).disabled=!layoutReady || saving;
    $("dd-layout-status").textContent=message ?? (saving?T("جارٍ الحفظ…","Saving…")
      :revision!==savedRevision?T("تغييرات غير محفوظة","Unsaved changes")
      :hasSaved?T("تم الحفظ","Saved"):"");
  }
  function markChanged() {
    revision++;
    updateSaveBar();
  }
  function syncBoardPicker() {
    const items=[...boards.values()].filter(board=>board.id!==activeBoard.id);
    items.push(activeBoard);
    items.sort((a,b)=>a.id==="default"?-1:b.id==="default"?1:a.name.localeCompare(b.name,locale));
    selectOptions($("dd-board-list"),items.map(board=>({value:board.id,label:board.id==="default"?presetTitle(board.name):board.name})),activeBoard.id,null);
  }
  function rememberBoard() {
    const url=new URL(window.location.href);
    if(activeBoard.id==="default")url.searchParams.delete("board");
    else url.searchParams.set("board",activeBoard.id);
    window.history.replaceState(window.history.state,"",url);
  }
  function activateBoard(board) {
    closeEditor();
    activeBoard={...board};
    revision=0;
    savedRevision=0;
    hasSaved=false;
    tablePages.clear();
    loadConfig(board.layout);
    syncBoardPicker();
    updateSaveBar();
    render();
  }
  async function saveLayout() {
    if(!layoutReady || saving || revision===savedRevision)return;
    saving=true;
    const snapshot=revision;
    const layout={version:3,name:activeBoard.name,charts:structuredClone(charts),updatedAt:Date.now()};
    let message;
    updateSaveBar();
    try {
      const token=root.querySelector('input[name="__RequestVerificationToken"]')?.value;
      const response=await fetch("/DynamicDashboard/SaveLayout?boardId="+encodeURIComponent(activeBoard.id),{
        method:"POST",credentials:"same-origin",
        headers:{...requestHeaders,"Content-Type":"application/json","RequestVerificationToken":token||""},
        body:JSON.stringify(layout)
      });
      if(!response.ok)throw new Error("HTTP "+response.status);
      savedRevision=snapshot;
      hasSaved=true;
      boards.set(activeBoard.id,{id:activeBoard.id,name:layout.name,layout});
      rememberBoard();
    } catch {
      message=T("تعذر الحفظ. حاول مرة أخرى.","Could not save. Try again.");
    } finally {
      saving=false;
      updateSaveBar(message);
    }
  }
  async function restoreServerLayout() {
    if(!root.dataset.scope) {
      updateSaveBar(T("الحفظ يتطلب حساب Laserfiche معروف الهوية.","Saving requires an identified Laserfiche account."));
      return;
    }
    try {
      const response=await fetch("/DynamicDashboard/Layout",{credentials:"same-origin",cache:"no-store",headers:requestHeaders});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const result=await response.json();
      boards.set(mainBoard.id,mainBoard);
      for(const board of result.boards)boards.set(board.id,board);
      const id=new URL(window.location.href).searchParams.get("board");
      layoutReady=true;
      activateBoard(boards.get(id)??boards.get(mainBoard.id));
      rememberBoard();
    } catch {
      layoutReady=false;
      updateSaveBar(T("تعذر تحميل لوحات التحكم.","Could not load dashboards."));
    }
  }
  const unique = values => [...new Set(values.filter(v => v !== null && v !== undefined && String(v).trim() !== "").map(String))];
  function selectOptions(element, items, selected, placeholder) {
    element.replaceChildren();
    if (placeholder !== null) {
      const first = document.createElement("option"); first.value = ""; first.textContent = placeholder;
      element.appendChild(first);
    }
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = String(item.value); opt.textContent = item.label;
      element.appendChild(opt);
    }
    element.value = selected ?? "";
    if (element.selectedIndex < 0) element.selectedIndex = 0;
  }
  const fieldMeta = id => [...BUILTIN,...fields].find(f=>String(f.id)===String(id));
  function kind(id) {
    const type=String(fieldMeta(id)?.type||"string").toLowerCase();
    if(type.includes("date")||type.includes("time"))return "date";
    if(/(integer|number|numeric|decimal|currency|float|double|long)/.test(type))return "number";
    if(/(bool|checkbox)/.test(type))return "boolean";
    if(/(list|select|dropdown|choice)/.test(type))return "list";
    return "text";
  }
  function valuesFor(row,id) {
    const raw=String(id);
    if(raw==="__template")return row.template?[row.template]:[];
    if(raw==="__creator")return row.creator?[row.creator]:[];
    if(raw==="__created")return row.created?[row.created]:[];
    if(raw==="__modified")return row.modified?[row.modified]:[];
    if(raw==="__folder")return row.folder?[row.folder]:[];
    if(raw==="__pages")return row.pages==null?[]:[String(row.pages)];
    const value=row.fields&&row.fields[raw];
    return Array.isArray(value)
      ? value.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(String) : [];
  }
  function number(value) {
    const arabic = "٠١٢٣٤٥٦٧٨٩", persian = "۰۱۲۳۴۵۶۷۸۹";
    const normalized = String(value).replace(/[٠-٩]/g,ch=>String(arabic.indexOf(ch)))
      .replace(/[۰-۹]/g,ch=>String(persian.indexOf(ch)))
      .replace(/٬/g,"").replace(/٫/g,".").replace(/,/g,"").trim();
    if (!normalized) return null;
    const n = Number(normalized); return Number.isFinite(n) ? n : null;
  }
  function dateStamp(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time) : null;
  }
  function dayKey(d) {
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
  }
  function groupKey(id,value) {
    if(id!=="__created"&&id!=="__modified")return String(value);
    const date=dateStamp(value);
    return date?date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0"):String(value);
  }
  function categoryKeys(row,dimension) {
    const keys=unique(valuesFor(row,dimension).map(v=>groupKey(dimension,v)));
    return keys.length?keys:[EMPTY_VALUE];
  }
  function observedValues(dimension, source=fieldRows(dimension)) {
    // Counts come from distinct readable documents, NOT a hardcoded list or field definition choices.
    const counts=new Map();
    for(const row of source)
      for(const value of new Set(categoryKeys(row,dimension)))
        counts.set(value,(counts.get(value)||0)+1);
    return [...counts.entries()]
      .map(([value,count])=>({value,count,label:value===EMPTY_VALUE?T("بدون قيمة","No value"):value}))
      .sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,locale));
  }
  function isFieldDimension(dimension) {
    return /^(?:\d+$|field:)/.test(dimension);
  }
  function fieldRows(dimension) {
    return isFieldDimension(dimension)
      ? rows.filter(row=>row.fields!=null && Object.hasOwn(row.fields,dimension)) : rows;
  }
  function selectedRows(chart) {
    let source=isRecent(chart.type)?rows:fieldRows(chart.dimension);
    const dateKey=dateColumn(chart);
    if(dateKey) {
      return source.filter(row=>{
        const day=dayKey(dateStamp(row[dateKey]));
        const modifiedAfterCreation=dateKey!=="modified" || !dateStamp(row.created) ||
          Date.parse(row.modified)>Date.parse(row.created);
        return day && modifiedAfterCreation && (!chart.from||day>=chart.from) && (!chart.to||day<=chart.to);
      });
    }
    if(!isRecent(chart.type) && chart.dimension==="__pages" && chart.pages!=null)
      return source.filter(row=>row.pages!=null && Number(row.pages)===chart.pages);
    if(isRecent(chart.type) || !chart.selectedValues.length)return source;
    const filter=new Set(chart.selectedValues);
    return source.filter(row=>categoryKeys(row,chart.dimension).some(v=>filter.has(v)!==Boolean(chart.allValues)));
  }
  function summary(chart) {
    const source=selectedRows(chart);
    if(chart.type==="kpi")return {kpi:new Set(source.map(x=>x.id)).size,items:source,groups:[],extra:0};
    const map=new Map(),selected=new Set(chart.dimension==="__pages" && chart.pages!=null ? [] : chart.selectedValues);
    for(const row of source) {
      for(const key of new Set(categoryKeys(row,chart.dimension))) {
        if(selected.size&&selected.has(key)===Boolean(chart.allValues))continue;
        if(!map.has(key))map.set(key,{key,label:key===EMPTY_VALUE?T("بدون قيمة","No value"):key,docs:[],ids:new Set()});
        const g=map.get(key);
        if(!g.ids.has(row.id)){g.ids.add(row.id);g.docs.push(row);}
      }
    }
    const list=[...map.values()].map(g=>({...g,value:g.ids.size}));
    if(chart.dimension==="__created"||chart.dimension==="__modified")
      list.sort((a,b)=>a.label.localeCompare(b.label));
    else list.sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,locale));
    const isChart=!isTable(chart.type) && !["doughnut","pie"].includes(chart.type);
    return {groups:isChart?list.slice(0,30):list,extra:isChart?Math.max(0,list.length-30):0,
      totalGroups:list.length,items:source};
  }
  function openArchive(title, docs) {
    const ids = [...new Set(docs.map(doc => doc.id))];
    if (!ids.length) return;
    const entryIds=ids.join(",");
    if(entryIds.length>300000) {
      window.alert(T("عدد النتائج أكبر من سعة فتح الأرشيف دفعة واحدة. ضيّق التصفية.","Too many results to open at once. Narrow the filters."));
      return;
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = root.dataset.archiveUrl;
    for (const [name, value] of [
      ["__RequestVerificationToken", root.querySelector('input[name="__RequestVerificationToken"]').value],
      ["title", title.slice(0, 180)],
      ["repository", root.dataset.repository], ["entryIds", entryIds]
    ]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    root.appendChild(form);
    form.submit();
  }

  function dateColumnsLimited(chart, source=selectedRows(chart)) {
    return Boolean(dateColumn(chart)) && new Set(source.map(row=>row.id)).size>10;
  }

  function displayType(chart) {
    if(isRecent(chart.type))return chart.type;
    if(dateColumn(chart) && (chart.type==="table" || isBar(chart.type) && dateColumnsLimited(chart)))
      return "documents";
    return chart.type;
  }

  function documentRows(chart) {
    const key=dateColumn(chart) ?? "created";
    const timestamp=row=>dateStamp(row[key])?.getTime() ?? 0;
    return [...selectedRows(chart)].sort((a,b)=>timestamp(b)-timestamp(a) || a.id-b.id);
  }

  function drawTable(body, chart, headers, rows, cells, activate) {
    body.classList.add("dd-table-visual");
    const wrap=document.createElement("div");
    wrap.className="dd-table-wrap";
    const table=document.createElement("table");
    table.className="dd-table";
    const head=table.createTHead().insertRow();
    for(const label of headers) {
      const th=document.createElement("th");
      th.scope="col";th.textContent=label;head.appendChild(th);
    }
    const tbody=table.createTBody();
    wrap.appendChild(table);
    const nav=document.createElement("nav");
    nav.className="dd-pager";
    nav.setAttribute("aria-label",T("صفحات الجدول","Table pagination"));
    body.append(wrap,nav);
    const size=10;
    const total=Math.max(1,Math.ceil(rows.length/size));
    function show(page) {
      page=Math.min(total,Math.max(1,page));
      tablePages.set(chart.id,page);
      tbody.replaceChildren();
      nav.replaceChildren();
      if(!rows.length) {
        const cell=tbody.insertRow().insertCell();
        cell.colSpan=headers.length;cell.textContent=T("لا توجد مستندات مطابقة.","No matching documents.");
      }
      for(const item of rows.slice((page-1)*size,page*size)) {
        const row=tbody.insertRow();
        cells(item).forEach((value,index)=>{
          const cell=row.insertCell();
          cell.dataset.label=headers[index];
          const text=document.createElement("span");
          text.textContent=value;
          cell.appendChild(text);
        });
        row.tabIndex=0;row.style.cursor="pointer";
        row.addEventListener("click",()=>activate(item));
        row.addEventListener("keydown",event=>{
          if(event.key==="Enter"||event.key===" "){event.preventDefault();activate(item);}
        });
      }
      nav.hidden=total===1;
      if(total===1)return;
      function button(label, target, disabled) {
        const control=iconButton(label,label,()=>show(target));
        control.className="dd-btn";
        control.disabled=disabled;
        nav.appendChild(control);
        return control;
      }
      button(T("السابق","Previous"),page-1,page===1);
      const first=Math.max(1,Math.min(page-2,total-4));
      for(let index=first;index<=Math.min(total,first+4);index++) {
        const control=button(String(index),index,index===page);
        if(index===page)control.setAttribute("aria-current","page");
      }
      button(T("التالي","Next"),page+1,page===total);
      const input=document.createElement("input");
      input.type="number";input.min="1";input.max=String(total);input.value=String(page);
      input.setAttribute("aria-label",T("رقم الصفحة","Page number"));
      const go=()=>{if(input.checkValidity() && input.value)show(Number(input.value));};
      const submit=iconButton(T("انتقال","Go"),T("انتقال","Go"),go);
      submit.className="dd-btn";
      input.addEventListener("keydown",event=>{if(event.key==="Enter")go();});
      nav.append(input,submit);
      nav.append(T("من ","of ")+total);
    }
    show(tablePages.get(chart.id)||1);
  }

  function drawDocumentTable(body,chart) {
    body.classList.add("dd-document-table");
    const modified=dateColumn(chart)==="modified" || !dateColumn(chart);
    const headers=[T("اسم المستند","Document name"),T("المجلد","Folder"),T("القالب","Template"),T("تاريخ الإنشاء","Date created"),
      ...(modified?[T("تاريخ التعديل","Date modified")]:[]),T("أنشأه","Created by"),T("عدد الصفحات","Page count")];
    const format=value=>dateStamp(value)?.toLocaleString(locale,{calendar:"gregory"})||"—";
    drawTable(body,chart,headers,documentRows(chart),row=>[row.name,row.folder||"—",row.template||"—",
      format(row.created),...(modified?[format(row.modified)]:[]),row.creator||"—",row.pages??"—"],
      row=>openArchive(row.name,[row]));
  }

  function iconButton(title,symbol,handler) {
    const b=document.createElement("button");b.type="button";b.className="dd-icon-btn";
    b.textContent=symbol;b.title=title;b.setAttribute("aria-label",title);
    b.addEventListener("click",handler);return b;
  }
  function visibilityButton(hidden, handler) {
    const button=iconButton(hidden?T("إظهار المؤشر","Show widget"):T("إخفاء المؤشر","Hide widget"),"",handler);
    button.setAttribute("aria-pressed",String(hidden));
    button.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>'+(hidden?'<path d="m3 3 18 18"/>':'')+'</svg>';
    return button;
  }
  function drawCard(chart) {
    const type=displayType(chart);
    const ghost=Boolean(chart.hidden);
    const el=document.createElement("article");
    el.className="dd-card"+(ghost?" dd-ghost":"");
    const documentTable=type==="documents" || isRecent(type);
    el.classList.toggle("dd-full-card",documentTable || chart.span===12);
    el.classList.toggle("dd-quarter-card",quarterWidth(chart) && chart.span===3);
    el.classList.toggle("dd-graph",!isTable(type)&&type!=="kpi"&&type!=="overview");
    el.dataset.id=chart.id;
    const header=document.createElement("header");header.className="dd-card-head";
    const headText=document.createElement("div"),title=document.createElement("strong");
    title.textContent=chart.id.startsWith("base-")?presetTitle(widgetTitle(chart)):widgetTitle(chart);headText.appendChild(title);
    const sub=document.createElement("small");sub.className="dd-card-sub";
    sub.textContent=isTable(type)&&type!=="table"?T("جدول الوثائق","Document table"):(fieldMeta(chart.dimension)?.name||T("الوثائق","Documents"))+T(" · عدد الوثائق"," · Document count");
    headText.appendChild(sub);
    const actions=document.createElement("div");actions.className="dd-card-actions";
    if(editMode) {
      const grip=iconButton(T("اسحب لتغيير المكان","Drag to reorder"),"⠿",()=>{});
      grip.classList.add("dd-drag-handle");grip.draggable=true;
      grip.addEventListener("keydown",event=>{
        if(!["ArrowUp","ArrowDown"].includes(event.key))return;
        event.preventDefault();moveCard(chart.id,event.key==="ArrowUp"?-1:1);
        [...$("dd-grid").children].find(card=>card.dataset.id===chart.id)?.querySelector(".dd-drag-handle")?.focus();
      });
      actions.append(grip,

        iconButton(T("تعديل المؤشر","Edit widget"),"⚙",()=>openEditor(chart.id)),
        ...(!documentTable?[iconButton(T("تبديل عرض الكرت","Change card width"),"⤢",
          ()=>setCardSpan(el,chart,nextCardSpan(chart)))]:[]),
        iconButton(T("نقل لأعلى","Move up"),"↑",()=>moveCard(chart.id,-1)),
        iconButton(T("نقل لأسفل","Move down"),"↓",()=>moveCard(chart.id,1)),
        visibilityButton(ghost,
          ()=>{chart.hidden=!chart.hidden;markChanged();render();}),
        iconButton(T("حذف المؤشر","Delete widget"),"×",()=>{if(window.confirm(T("حذف هذا المؤشر من لوحتك؟","Delete this widget from your dashboard?"))){
          tablePages.delete(chart.id);charts=charts.filter(c=>c.id!==chart.id);markChanged();render();}})
      );
    }
    header.append(headText,actions);el.appendChild(header);
    const body=document.createElement("div");body.className="dd-visual";
    el.appendChild(body);
    if(editMode && !documentTable)attachResize(el,chart);
    if(ghost) {
      const text=document.createElement("p");text.className="dd-ghost-note";
      text.textContent=T("العنصر مخفي؛ اضغط زر العين لإظهاره","This widget is hidden. Use the visibility button to show it.");
      body.appendChild(text);
    } else if(type==="overview") {
      const original=overview.get(chart.id);
      if(original?.node) {
        el.classList.add("dd-native-widget");
        if(original.label) {
          const decoration=[...original.label.children];
          original.label.replaceChildren(...decoration,document.createTextNode(widgetTitle(chart)));
        }
        body.appendChild(original.node);
      } else {
        body.textContent=T("لا تتوفر البيانات الأصلية حاليًا.","Original data is currently unavailable.");
      }
    } else if(type==="documents" || isRecent(type)) {
      drawDocumentTable(body,chart);
    } else {
      const data=summary(chart);
      const partialText=partial && isFieldDimension(chart.dimension)?T("قد تكون بعض قيم الحقول غير متاحة.","Some field values may be unavailable."):"";
      if(data.extra) {
        const note=document.createElement("small");note.className="dd-chart-note";
        note.textContent=T("عرض أول 30 فئة من ","Showing the first 30 of ")+data.totalGroups+T("؛ اختر قيمًا محددة لعرض المزيد."," categories. Select specific values to see more.");
        body.appendChild(note);
      }
      if(partialText) {
        const note=document.createElement("small");note.className="dd-chart-note dd-partial-note";
        note.textContent=partialText;body.appendChild(note);
      }
      if(chart.type==="kpi") {
        const k=document.createElement("div");k.className="dd-kpi";
        k.textContent=Number(data.kpi).toLocaleString(locale);
        const small=document.createElement("small");
        small.textContent=T("وثيقة مطابقة للقيم المعروضة","documents matching the displayed values");
        k.appendChild(small);body.appendChild(k);
        if(data.items.length) {
          k.tabIndex=0;
          k.setAttribute("role","button");
          k.style.cursor="pointer";
          k.addEventListener("click",()=>openArchive(chart.title,data.items));
          k.addEventListener("keydown",event=>{
            if(event.key==="Enter"||event.key===" "){event.preventDefault();k.click();}
          });
        }
      } else if(chart.type==="table") {
        drawTable(body,chart,[fieldMeta(chart.dimension)?.name||T("القيمة","Value"),T("عدد الوثائق","Document count")],data.groups,
          group=>[group.label,group.value.toLocaleString(locale)],
          group=>openArchive(group.label,group.docs));
      } else if(!window.Chart) {
        const p=document.createElement("p");p.textContent=T("مكتبة الرسم المحلي غير متاحة","The local chart library is unavailable.");body.appendChild(p);
      } else {
        const stage=document.createElement("div");stage.className="dd-chart-stage";
        const canvas=document.createElement("canvas");stage.appendChild(canvas);body.appendChild(stage);
        const type=chart.type==="horizontal"?"bar":chart.type, axis=chart.type==="horizontal";
        const circ=["doughnut","pie"].includes(type);
        if(circ) {
          const layout=document.createElement("div");layout.className="dashboard-round-layout";
          stage.className="dashboard-round-stage";
          const legend=document.createElement("div");legend.className="dashboard-round-results";legend.dir=arabic?"rtl":"ltr";
          for(let i=0;i<data.groups.length;i++) {
            const group=data.groups[i],btn=document.createElement("button");
            btn.type="button";btn.className="dashboard-round-row";
            const dot=document.createElement("span");dot.className="dashboard-round-dot";
            dot.style.backgroundColor=palette[i%palette.length];
            const label=document.createElement("span");label.className="dashboard-round-label";label.textContent=group.label;label.title=group.label;
            const count=document.createElement("strong");count.textContent=group.value.toLocaleString(locale);
            btn.append(dot,label,count);
            btn.addEventListener("click",()=>openArchive(group.label,group.docs));
            legend.appendChild(btn);
          }
          layout.append(stage,window.dashboardRoundScroll(legend,arabic));
          body.appendChild(layout);
        }
        const config={
          type,
          data:{labels:data.groups.map(g=>g.label),datasets:[{
            label:T("عدد الوثائق","Document count"),data:data.groups.map(g=>g.value),
            borderColor:palette[0],backgroundColor:type==="line"?palette[0]:data.groups.map((_,i)=>palette[i%palette.length]),
            ...(circ?{radius:"96%"}:{}),
            fill:false,borderWidth:type==="line"?2:0,tension:.27,borderRadius:type==="bar"?4:0
          }]},
          options:{
            responsive:true,maintainAspectRatio:false,indexAxis:axis?"y":"x",
            plugins:{legend:{display:false},tooltip:{backgroundColor:"#0b1c49"}},
            scales:circ?{}:{
              x:{grid:{display:axis,color:"#eef1f6"},ticks:{font:{size:14},color:"#506678",maxRotation:30,autoSkip:true}},
              y:{beginAtZero:true,grid:{color:axis?"transparent":"#eef1f6"},ticks:{font:{size:14},color:"#506678"}}
            },
            onClick:(_,points)=>{const group=data.groups[points[0]?.index];if(group)openArchive(group.label,group.docs);}
          }
        };
        instances.push(new Chart(canvas,config));
      }
    }
    el.addEventListener("dragstart",event=>{
      if(!editMode || !event.target.closest(".dd-drag-handle")) {event.preventDefault();return;}
      event.dataTransfer?.setData("text/plain",chart.id);
      if(event.dataTransfer)event.dataTransfer.effectAllowed="move";
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend",()=>{
      el.classList.remove("is-dragging");
      $("dd-grid").querySelectorAll(".dd-drop-target").forEach(card=>card.classList.remove("dd-drop-target"));
    });
    el.addEventListener("dragover",event=>{
      if(editMode && $("dd-grid").querySelector(".is-dragging")!==el){
        event.preventDefault();el.classList.add("dd-drop-target");
      }
    });
    el.addEventListener("dragleave",event=>{if(!el.contains(event.relatedTarget))el.classList.remove("dd-drop-target");});
    el.addEventListener("drop",event=>{
      if(!editMode || busy)return;
      event.preventDefault();const source=event.dataTransfer?.getData("text/plain");
      if(!source||source===chart.id)return;
      const i=charts.findIndex(c=>c.id===source),j=charts.findIndex(c=>c.id===chart.id);
      if(i<0||j<0)return;
      charts.splice(j,0,charts.splice(i,1)[0]);markChanged();render();
    });
    return el;
  }
  function moveCard(id, offset) {
    const index=charts.findIndex(card=>card.id===id);
    const target=index+offset;
    if(index<0 || target<0 || target>=charts.length)return;
    charts.splice(target,0,charts.splice(index,1)[0]);
    markChanged();render();
  }
  function nextCardSpan(chart) {
    return chart.span===12?(quarterWidth(chart)?3:6):chart.span===3?6:12;
  }
  function narrowerCardSpan(chart) {
    return quarterWidth(chart) && chart.span<=6?3:6;
  }
  function setCardSpan(card,chart,span) {
    if(chart.span===span)return;
    chart.span=span;
    card.classList.toggle("dd-full-card",span===12);
    card.classList.toggle("dd-quarter-card",quarterWidth(chart) && span===3);
    markChanged();
  }
  function attachResize(card,chart) {
    const handle=iconButton(chart.type==="kpi"?T("تغيير عرض بطاقة الأرقام","Resize number card"):T("تغيير العرض إلى نصف الصف أو عرضه الكامل","Resize to half or full row width"),"↔",
      event=>{if(event.detail===0)setCardSpan(card,chart,nextCardSpan(chart));});
    handle.classList.add("dd-resize-handle");
    card.appendChild(handle);
    handle.addEventListener("pointerdown",event=>{
      if(event.button!==0 || !event.isPrimary)return;
      event.preventDefault();
      handle.focus({preventScroll:true});
      handle.setPointerCapture(event.pointerId);
      const rtl=getComputedStyle(card).direction==="rtl";
      const finish=next=>{
        handle.removeEventListener("pointerup",finish);
        handle.removeEventListener("lostpointercapture",cancel);
        const distance=(next.clientX-event.clientX)*(rtl?-1:1);
        // Keep the canvas and its labels stable until the resize is committed.
        if(Math.abs(distance)>=24)setCardSpan(card,chart,distance>0?(chart.span===3?6:12):narrowerCardSpan(chart));
      };
      const cancel=()=>handle.removeEventListener("pointerup",finish);
      handle.addEventListener("pointerup",finish,{once:true});
      handle.addEventListener("lostpointercapture",cancel,{once:true});
    });
    handle.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight"].includes(event.key))return;
      event.preventDefault();
      const rtl=getComputedStyle(card).direction==="rtl";
      setCardSpan(card,chart,(event.key==="ArrowLeft")===rtl?(chart.span===3?6:12):narrowerCardSpan(chart));
    });
  }
  function render() {
    instances.forEach(c=>c.destroy());instances=[];
    root.classList.toggle("dd-edit-mode",editMode);
    $("dd-customize").textContent=editMode?T("✓ إنهاء التخصيص","✓ Finish customizing"):T("⚙ تخصيص اللوحة","⚙ Customize dashboard");
    $("dd-customize").setAttribute("aria-pressed",String(editMode));
    $("dd-add").classList.toggle("dd-hidden",!editMode);
    overviewStorage.hidden=true;
    if(overviewAlert) {
      $("dd-grid").before(overviewAlert);
      overviewAlert.hidden=activeBoard.id!=="default";
    }
    for(const {node} of overview.values())if(node)overviewRoot.appendChild(node);
    $("dd-grid").replaceChildren(...charts.filter(chart=>editMode || !chart.hidden).map(drawCard));
    $("dd-empty").classList.toggle("dd-hidden",charts.some(c=>!c.hidden)||editMode&&charts.length>0);
  }
  function valueChoices() {
    const target=$("dd-value-list");target.replaceChildren();
    if(!editing||!editing.dimension||editing.type==="overview")return;
    const term=$("dd-value-search").value.trim().toLocaleLowerCase();
    if(dateColumn(editing) || isRecent(editing.type) || editing.dimension==="__pages")return;
    const categories=observedValues(editing.dimension);
    const visible=categories.filter(x=>x.label.toLocaleLowerCase().includes(term));
    const selected=new Set(editing.selectedValues);
    if(!visible.length) {
      const p=document.createElement("p");p.className="dd-values-help";
      p.textContent=term?T("لا توجد قيم تطابق البحث.","No values match your search.")
        :partial && isFieldDimension(editing.dimension)?T("لم تصل قيم قابلة للعرض لهذا الحقل. بعض بيانات الحقول غير مكتملة.","No values are available for this field. Some field data is incomplete.")
        :T("لم يُرجع Laserfiche قيماً لهذا الحقل ضمن الوثائق المقروءة.","Laserfiche returned no values for this field in the readable documents.");
      target.appendChild(p);
    }
    for(const category of visible) {
      const label=document.createElement("label");label.className="dd-value-option";
      const check=document.createElement("input");check.type="checkbox";
      check.checked=editing.allValues?!selected.has(category.value):selected.has(category.value);check.value=category.value;
      check.addEventListener("change",()=>{
        const set=new Set(editing.selectedValues);
        if(check.checked!==editing.allValues)set.add(category.value);else set.delete(category.value);
        editing.selectedValues=[...set];updateEditorSource();valueChoices();
      });
      const text=document.createElement("span");text.textContent=category.label;
      const count=document.createElement("small");
      count.textContent=category.count.toLocaleString(locale)+T(" وثيقة"," documents");
      label.append(check,text,count);target.appendChild(label);
    }
  }
  function openEditor(id) {
    if(!editMode || busy)return;
    if(id===null && charts.length>=80) {
      window.alert(T("الحد الأقصى 80 بطاقة لكل لوحة.","A dashboard can have up to 80 widgets."));
      return;
    }
    const item=charts.find(c=>c.id===id);
    editing=item?structuredClone(item):{
      id:"custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),
      title:T("مؤشر جديد","New widget"),type:"table",dimension:"__template",
      wide:false,hidden:false,selectedValues:[]
    };
    $("dd-overview-type").hidden=!editing.id.startsWith("overview-");
    $("dd-overview-type").disabled=$("dd-overview-type").hidden;
    $("dd-title").value=editing.id.startsWith("base-")?presetTitle(widgetTitle(editing)):widgetTitle(editing);$("dd-type").value=editing.type;
    $("dd-modified-from").value=editing.from||"";
    $("dd-modified-to").value=editing.to||"";
    $("dd-pages").value=editing.pages??"";
    $("dd-filter-error").classList.add("dd-hidden");
    const isField=Boolean(editing.dimension) && !BUILTIN.some(f=>f.id===editing.dimension);
    selectOptions($("dd-dimension"),[
      ...BUILTIN.map(f=>({value:f.id,label:f.name})),
      {value:"__fields",label:T("حقول","Fields")}
    ],isField?"__fields":editing.dimension,null);
    const fieldOptions=fields.map(f=>({value:String(f.id),label:f.name+(f.multi?T(" (قيم متعددة)"," (multiple values)"):"")}));
    if(isField&&!fieldOptions.some(f=>f.value===editing.dimension))
      fieldOptions.push({value:editing.dimension,label:T("حقل محفوظ (","Saved field (")+editing.dimension+")"});
    selectOptions($("dd-field"),fieldOptions,isField?editing.dimension:"",T("اختر الحقل","Select a field"));
    $("dd-value-search").value="";
    updateEditorSource();
    valueChoices();
    $("dd-editoroverlay").classList.remove("dd-hidden");
  }
  function updateEditorSource() {
    const recent=isRecent(editing.type) || editing.type==="overview";
    const dateKey=dateColumn(editing);
    const usesField=$("dd-dimension").value==="__fields";
    $("dd-axis-options").classList.toggle("dd-hidden",recent);
    $("dd-field-options").classList.toggle("dd-hidden",!usesField || recent);
    $("dd-modified-range").classList.toggle("dd-hidden",!dateKey);
    $("dd-page-count").classList.toggle("dd-hidden",recent || editing.dimension!=="__pages");
    $("dd-category-options").classList.toggle("dd-hidden",recent || Boolean(dateKey) || editing.dimension==="__pages");
    const draft={...editing,from:$("dd-modified-from").value,to:$("dd-modified-to").value};
    const tooMany=!recent && dateColumnsLimited(draft);
    for(const option of $("dd-type").options) {
      option.disabled=option.value==="overview"?option.hidden:isBar(option.value) && tooMany;
    }
    if($("dd-type").selectedOptions[0]?.disabled) {
      editing.type="documents";
      $("dd-type").value=editing.type;
    }
    const limit=$("dd-display-limit");
    limit.textContent=tooMany?T("الأعمدة متاحة حتى ١٠ وثائق ضمن نطاق التاريخ.","Bar charts are available for up to 10 documents in the date range."):"";
    limit.classList.toggle("dd-hidden",!limit.textContent);
    $("dd-save").disabled=!recent&&!editing.dimension;
  }
  function changeDimension() {
    if(!editing)return;
    editing.dimension=$("dd-dimension").value==="__fields"?$("dd-field").value:$("dd-dimension").value;
    editing.selectedValues=[];
    editing.allValues=false;
    $("dd-value-search").value="";
    updateEditorSource();
    valueChoices();
  }
  const closeEditor=()=>{$("dd-editoroverlay").classList.add("dd-hidden");editing=null;};
  function saveEditor() {
    if(!editing)return;
    editing.title=$("dd-title").value.trim()||T("مؤشر بدون عنوان","Untitled widget");
    editing.type=$("dd-type").value;
    if(editing.type!=="overview"&&!isRecent(editing.type)&&!editing.dimension)return;
    editing.from=dateColumn(editing)?$("dd-modified-from").value:"";
    editing.to=dateColumn(editing)?$("dd-modified-to").value:"";
    editing.pages=editing.dimension==="__pages"?pageCount($("dd-pages").value):null;
    const invalidRange=editing.from && editing.to && editing.from>editing.to;
    const invalidPages=editing.type!=="overview" && !isRecent(editing.type) && editing.dimension==="__pages" && $("dd-pages").value.trim()!=="" && editing.pages===null;
    if(invalidRange || invalidPages) {
      const error=$("dd-filter-error");
      error.textContent=invalidRange?T("تاريخ البداية يجب أن يسبق تاريخ النهاية أو يطابقه.","The start date must be on or before the end date."):T("أدخل رقمًا عشريًا أو صحيحًا يبدأ من صفر.","Enter a nonnegative number.");
      error.classList.remove("dd-hidden");
      return;
    }
    if(editing.dimension==="__pages" || dateColumn(editing)) {
      editing.selectedValues=[];
      editing.allValues=false;
    }
    if(isBar(editing.type) && dateColumnsLimited(editing))editing.type="documents";
    tablePages.delete(editing.id);
    // Only store chosen category identifiers; aggregation always counts unique documents.
    if(overview.get(editing.id)?.title===editing.title)editing.title="";
    const entry=normalChart(editing);
    const index=charts.findIndex(c=>c.id===entry.id);
    if(index>=0)charts[index]=entry;else charts.push(entry);
    markChanged();closeEditor();render();
  }
  async function refresh() {
    if(busy)return;busy=true;
    if(editing)closeEditor();
    $("dd-refresh").disabled=true;
    $("dd-customize").disabled=true;
    root.classList.add("dd-is-loading");
    root.querySelector(".dd-content").inert=true;
    $("dd-grid").setAttribute("aria-busy","true");
    $("dd-warning").classList.add("dd-hidden");
    try {
      const records=await fetch("/DynamicDashboard/Rows",{credentials:"same-origin",cache:"no-store",headers:requestHeaders});
      if(records.status===409)throw new Error(T("تغيّرت الجلسة أو المستودع. أعد تحميل الصفحة.","The session or repository changed. Reload the page."));
      if(!records.ok)throw new Error([401,403].includes(records.status)
        ?T("لا توجد صلاحية لقراءة بيانات هذه الجلسة. سجل الدخول من جديد.","You cannot read data in this session. Sign in again.")
        :T("تعذر إكمال قراءة الوثائق والحقول من Laserfiche.","Could not finish reading documents and fields from Laserfiche."));
      const result=await records.json();
      if(!Array.isArray(result.fields)||!Array.isArray(result.rows))throw new Error(T("استجابة غير متوقعة من Laserfiche.","Unexpected response from Laserfiche."));
      fields=result.fields;rows=result.rows;partial=Boolean(result.fieldDataIncomplete);
      if(partial){
        $("dd-warning").textContent=T("بعض بيانات الحقول لم ترجع كاملة من Laserfiche. تعرض المؤشرات القيم المتاحة فقط.","Laserfiche returned incomplete field data. Widgets show available values only.");
        $("dd-warning").classList.remove("dd-hidden");
      }
      render();
    } catch(error) {
      $("dd-warning").textContent=String(error.message||error);
      $("dd-warning").classList.remove("dd-hidden");
      rows=[];fields=[];partial=false;render();
    } finally{
      busy=false;$("dd-refresh").disabled=false;$("dd-customize").disabled=false;
      root.classList.remove("dd-is-loading");
      root.querySelector(".dd-content").inert=false;
      $("dd-grid").removeAttribute("aria-busy");
    }
  }
  function wireRepositorySwitch() {
    const dialog=$("dd-repository-dialog"), form=dialog.querySelector("form");
    const select=$("dd-repository-list"), submit=$("dd-repository-submit");
    const password=$("dd-repository-password"), message=$("dd-repository-message");
    const manual=$("dd-repository-manual"), manualWrap=$("dd-repository-manual-wrap");
    function showManual() {
      if(root.dataset.passwordSwitch!=="true")return;
      select.hidden=true;select.disabled=true;
      manualWrap.hidden=false;manual.disabled=false;manual.required=true;
      $("dd-repository-password-wrap").hidden=false;
      password.required=true;submit.disabled=false;
      message.textContent+=" "+T("أدخل معرّف المستودع وكلمة مرور حسابك.", "Enter the repository ID and your account password.");
    }
    $("dd-repository").addEventListener("click",async()=>{
      password.value="";
      manual.value="";manual.disabled=true;manual.required=false;manualWrap.hidden=true;
      select.hidden=false;select.disabled=false;
      password.required=false;
      $("dd-repository-password-wrap").hidden=true;
      select.replaceChildren();
      submit.disabled=true;
      message.textContent=T("جارٍ قراءة المستودعات…","Loading repositories…");
      dialog.showModal();
      try {
        const response=await fetch("/DynamicDashboard/Repositories",
          {credentials:"same-origin",cache:"no-store",headers:requestHeaders});
        if(!response.ok)throw new Error();
        const result=await response.json();
        const choices=result.repositories.filter(item=>
          item.id.toLowerCase()!==root.dataset.repository.toLowerCase());
        selectOptions(select,choices.map(item=>({value:item.id,label:item.name||item.id})),
          "",T("اختر المستودع","Select a repository"));
        $("dd-repository-password-wrap").hidden=!result.requiresPassword;
        password.required=Boolean(result.requiresPassword);
        message.textContent=choices.length?"":T("لا توجد مستودعات أخرى في القائمة التي أعادها Laserfiche.","Laserfiche returned no other repositories.");
        submit.disabled=!choices.length;
        if(!choices.length)showManual();
      } catch {
        message.textContent=T("تعذر قراءة المستودعات من Laserfiche.","Could not load repositories from Laserfiche.");
        showManual();
      }
    });
    $("dd-repository-cancel").addEventListener("click",()=>dialog.close());
    dialog.addEventListener("close",()=>{password.value="";});
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(saving || revision!==savedRevision && !window.confirm(T("توجد تغييرات غير محفوظة. تبديل المستودع؟","There are unsaved changes. Switch repositories?")))return;
      submit.disabled=true;
      message.textContent="";
      try {
        const response=await fetch(form.action,{
          method:"POST",credentials:"same-origin",headers:requestHeaders,body:new FormData(form)
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok || !result.url)throw new Error(result.error||T("تعذر تبديل المستودع.","Could not switch repositories."));
        window.location.assign(result.url);
      } catch(error) {
        password.value="";
        message.textContent=error.message;
        submit.disabled=false;
      }
    });
  }

  function wireBoards() {
    const dialog=$("dd-board-dialog");
    const name=$("dd-board-name");
    const list=$("dd-board-list");
    let creating=false;
    const canLeave=()=>!saving && (revision===savedRevision ||
      window.confirm(T("توجد تغييرات غير محفوظة. هل تتابع؟","There are unsaved changes. Continue?")));
    list.addEventListener("change",()=>{
      if(!canLeave()) {list.value=activeBoard.id;return;}
      const board=boards.get(list.value);
      if(board) {
        activateBoard(board);
        rememberBoard();
      }
    });
    const open=create=>{
      if(create && !canLeave())return;
      creating=create;
      $("dd-board-dialog-title").textContent=create?T("لوحة جديدة","New dashboard"):T("تغيير اسم اللوحة","Rename dashboard");
      $("dd-board-error").textContent="";
      name.value=create?"":activeBoard.name;
      dialog.showModal();
      name.focus();
    };
    $("dd-new-board").addEventListener("click",()=>open(true));
    $("dd-rename-board").addEventListener("click",()=>open(false));
    $("dd-board-cancel").addEventListener("click",()=>dialog.close());
    dialog.querySelector("form").addEventListener("submit",event=>{
      event.preventDefault();
      const value=name.value.trim();
      if(!value) {
        $("dd-board-error").textContent=T("أدخل اسم اللوحة.","Enter a dashboard name.");
        return;
      }
      if(creating) {
        const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),
          byte=>byte.toString(16).padStart(2,"0")).join("");
        editMode=true;
        activateBoard({id,name:value,layout:{version:3,charts:[]}});
        hasSaved=false;
      } else activeBoard.name=value;
      syncBoardPicker();
      markChanged();
      dialog.close();
    });
  }
  function wire() {
    wireRepositorySwitch();
    wireBoards();
    $("dd-save-layout").addEventListener("click",saveLayout);
    window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload();});
    $("dd-refresh").addEventListener("click",refresh);
    $("dd-customize").addEventListener("click",()=>{
      editMode=!editMode;
      if(!editMode)closeEditor();
      render();
    });
    $("dd-add").addEventListener("click",()=>openEditor(null));
    $("dd-closeeditor").addEventListener("click",closeEditor);
    $("dd-cancel").addEventListener("click",closeEditor);
    $("dd-save").addEventListener("click",saveEditor);
    $("dd-editoroverlay").addEventListener("click",event=>{
      if(event.target===$("dd-editoroverlay"))closeEditor();
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape")closeEditor();
    });
    $("dd-type").addEventListener("change",event=>{
      if(!editing)return;
      editing.type=event.target.value;
      updateEditorSource();
      valueChoices();
    });
    $("dd-dimension").addEventListener("change",changeDimension);
    $("dd-field").addEventListener("change",changeDimension);
    $("dd-value-search").addEventListener("input",valueChoices);
    for(const id of ["dd-modified-from","dd-modified-to"])
      $(id).addEventListener("input",()=>{if(editing)updateEditorSource();});
    $("dd-clear-values").addEventListener("click",()=>{
      if(!editing||!editing.dimension)return;
      editing.allValues=true;
      editing.selectedValues=[];
      $("dd-value-search").value="";
      updateEditorSource();
      valueChoices();
    });
  }
  loadConfig(null);wire();
  document.addEventListener("DOMContentLoaded",()=>restoreServerLayout().finally(refresh),{once:true});
})();
