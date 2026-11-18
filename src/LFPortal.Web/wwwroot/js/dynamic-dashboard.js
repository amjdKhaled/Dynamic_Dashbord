/* Dynamic Dashboard: no remote dependencies, no fabricated repository data. */
(() => {
  "use strict";
  const root = document.getElementById("dynamicDashboard");
  if (!root) return;
  const arabic = root.dataset.language === "ar";
  const locale = arabic ? "ar-SA" : "en";
  const T = (ar,en) => arabic ? ar : en;
  // Match the server-side SASO display alias. Physical metadata names remain unchanged.
  const groupedTemplateName = value => /^SASO(?:\s*\(\s*[1-6]\s*\)|\s+[1-6])?$/i.test(String(value ?? "").trim())
    ? "SASO" : String(value ?? "").trim();
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
  const widgetTitle = chart => chart.title || overview.get(chart.id)?.title || T("جدول","Table");
  const EMPTY_VALUE = "\u0000no-value";
  const validTypes = ["bar","horizontal","line","doughnut","pie","table","documents","kpi","recent-created","recent-modified","overview"];
  const isRecent = type => type==="recent-created" || type==="recent-modified";
  const isTable = type => type==="table" || type==="documents" || isRecent(type);
  const dateColumn = chart => chart.type==="overview" ? null : chart.type==="recent-modified" || (!isRecent(chart.type) && chart.dimension==="__modified")
    ? "modified" : chart.type==="recent-created" || chart.dimension==="__created" ? "created" : null;
  const isGraph = type => ["bar","horizontal","line","doughnut","pie"].includes(type);
  const nativeColors = new WeakMap();
  const colorNames = [T("كحلي","Navy"),T("أزرق سماوي","Sky blue"),T("ذهبي","Gold"),
    T("أزرق بترولي","Petrol blue"),T("أخضر","Green"),T("رمادي مزرق","Blue gray"),T("ذهبي فاتح","Light gold")];
  const nativeGraph = chart => {
    const canvas=overview.get(chart.id)?.node.querySelector(".chart-container canvas,.dashboard-round-stage canvas");
    return canvas && window.Chart?.getChart(canvas);
  };
  const nativeKey = (label,index) => JSON.stringify([index,label]);
  function paintNativeGraph(chart,node) {
    const graph=nativeGraph(chart);
    if(!graph)return;
    if(!nativeColors.has(graph)) {
      if(!Object.keys(chart.colors).length)return;
      nativeColors.set(graph,graph.data.datasets.map(set=>set.backgroundColor));
    }
    const defaults=nativeColors.get(graph);
    graph.data.datasets.forEach((set,index)=>{
      const colors=graph.data.labels.map((label,i)=>chart.colors[nativeKey(label,index)] ??
        (Array.isArray(defaults[index])?defaults[index][i]:defaults[index]));
      set.backgroundColor=Object.keys(chart.colors).length?colors:defaults[index];
      if(graph.config.type==="doughnut" || graph.config.type==="pie") {
        node.querySelectorAll(".dashboard-round-dot").forEach((dot,i)=>dot.style.backgroundColor=colors[i]);
      }
    });
    graph.update("none");
  }
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
  // With the Admin Portal: the people its groups let this account see (as in «المستندات حسب نشاط
  // المستخدم»). Grouping by «المستخدم / المنشئ» counts only their documents. null: everyone.
  let people = null;
  const boards = new Map();
  const mainBoard = {id:"default",name:T("اللوحة الرئيسية","Main dashboard"),layout:null};
  // What the Admin Portal gives this account (everything without the portal). A board given
  // to it arrives with readOnly and its owner: it is shown, never changed.
  const mainAllowed = root.dataset.mainBoard !== "false";
  // «تخصيص اللوحة»: customize mode and all it shows (the + button, the table buttons, and the
  // settings and delete buttons of one's own boards). A new board starts empty, so creating needs it.
  const canCustomize = root.dataset.canCustomize !== "false";
  const canCreate = canCustomize && root.dataset.canCreate !== "false";
  // «يختار أن تكون اللوحة عامة أو خاصة». Without it every new board is private, and nothing on the
  // page speaks of public or private: no question when creating, no «خاصة» tag in the list.
  const choosesVisibility = canCreate && root.dataset.choosesVisibility !== "false";
  const noBoard = {id:"",name:T("لا توجد لوحات","No dashboards"),layout:{version:3,charts:[]},none:true};
  const locked = () => Boolean(activeBoard.readOnly || activeBoard.none);
  const editable = () => canCustomize && !locked();
  // Who sees a board: "private" (its owner only) or "public" (listed in the Admin Portal, which
  // may give it to others). Boards saved before this choice are public; the main board has none.
  const visibilityOf = board => board.id==="default" || board.none ? undefined
    : (board.visibility ?? board.layout?.visibility)==="private" ? "private" : "public";
  const lockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const boardOrder = (a,b)=>a.id==="default"?-1:b.id==="default"?1:Boolean(a.readOnly)-Boolean(b.readOnly) ||
    a.name.localeCompare(b.name,locale);
  // The board to open when none is asked for, or when the open one is gone.
  const fallbackBoard = () => boards.get(mainBoard.id) ?? [...boards.values()].sort(boardOrder)[0] ?? noBoard;
  let activeBoard = mainAllowed ? {...mainBoard} : {...noBoard};
  let partial = false, busy = false, editMode = false, revision = 0, savedRevision = 0, saving = false, savedFlash = false, layoutReady = false, deleting = false;

  const quarterWidth = chart => chart.type==="kpi" || (chart.type==="overview" && overview.get(chart.id)?.span===3);

  const numberSpans = [3,4,6,8,12];
  const desktopColumns = 10;
  async function dashboardFetch(url, options, allowCredentialError=false) {
    const response=await fetch(url,options);
    const finalUrl=new URL(response.url || url,location.href);
    if(finalUrl.origin===location.origin && finalUrl.pathname==="/Login") {
      location.assign(finalUrl.href);
      throw new Error(T("انتهت الجلسة.","Session expired."));
    }
    if(response.status===401) {
      const payload=await response.clone().json().catch(()=>null);
      if(payload?.loginUrl || !allowCredentialError) {
        const destination=location.pathname+location.search;
        location.assign("/Login?returnUrl="+encodeURIComponent(destination));
        throw new Error(T("انتهت الجلسة.","Session expired."));
      }
    }
    return response;
  }
  const vacantRows=new Map();
  const desktopGrid=()=>window.matchMedia("(min-width: 1100px)").matches;
  let desktopLayout = new Map();

  function cardSpan(chart) {
    if(chart.span==null)return chart.wide || isTable(chart.type)?12:quarterWidth(chart)?3:6;
    // Keep saved half/full widths; only number cards can occupy a quarter row.
    if(quarterWidth(chart) && numberSpans.includes(Number(chart.span)))return Number(chart.span);
    return Number(chart.span)>=9?12:6;
  }

  function normalChart(chart) {
    const oldName = chart.dimension==="__name";
    const legacy=chart.type==="comparison";
    const type=legacy && (isGraph(chart.comparisonView) || chart.comparisonView==="table")?chart.comparisonView:
      legacy?"table":chart.type==="audit"?"recent-modified":chart.type;
    const templateFields=Array.isArray(chart.templateFields)?chart.templateFields:
      legacy && Array.isArray(chart.comparison)?chart.comparison.map(side=>({template:side?.template,fields:[side?.field]})):[];
    const fieldsByTemplate=new Map();
    for(const item of templateFields) {
      if(typeof item?.template!=="string" || !Array.isArray(item.fields))continue;
      const valid=item.fields.filter(field=>typeof field==="string" && isFieldDimension(field));
      const template=groupedTemplateName(item.template);
      fieldsByTemplate.set(template,unique([...(fieldsByTemplate.get(template)??[]),...valid]));
    }
    const title = chart.type==="audit" ? T("نشاط المستندات الأخير","Recent document activity") : String(chart.title ?? (overview.has(chart.id)?"":T("جدول","Table")));
    return {
      id:String(chart.id), title:title.replace(/^شارت(?= جديد$| بدون عنوان$|$)/,T("جدول","Table")).slice(0,90),
      type:validTypes.includes(type) && (type!=="overview" || chart.id.startsWith("overview-"))?type:"bar",
      dimension:oldName || legacy?"__template":String(chart.dimension||"__template"),
      span:cardSpan({...chart,type}),
      width:Number.isInteger(chart.width) && chart.width>=2 && chart.width<=desktopColumns?chart.width:null,
      slot:Number.isInteger(chart.slot?.row) && chart.slot.row>=0 && chart.slot.row<160 &&
        Number.isInteger(chart.slot.column) && chart.slot.column>=0 && chart.slot.column<desktopColumns
        ? {row:chart.slot.row,column:chart.slot.column}:null,
      from:validDate(chart.from)?chart.from:"",
      to:validDate(chart.to)?chart.to:"",
      pages:pageCount(chart.pages),
      hidden:Boolean(chart.hidden),
      accent:chart.accent===undefined ? chart.id==="overview-folders-total" : Boolean(chart.accent),
      templateValueFilters:Array.isArray(chart.templateValueFilters)?chart.templateValueFilters
        .filter(rule=>fieldsByTemplate.get(groupedTemplateName(rule?.template))?.includes(rule.field) && Array.isArray(rule.values))
        .map(rule=>({template:groupedTemplateName(rule.template),field:rule.field,values:unique(rule.values.filter(value=>typeof value==="string"))})):[],
      templateFields:[...fieldsByTemplate].filter(([,fields])=>fields.length).map(([template,fields])=>({template,fields})),
      colors:Object.fromEntries(Object.entries(chart.colors ?? {}).filter(([,color])=>palette.includes(color)).slice(0,500)),
      allValues:!legacy && Boolean(chart.allValues),
      selectedValues:legacy?unique(templateFields.map(item=>groupedTemplateName(item?.template))):!oldName && Array.isArray(chart.selectedValues)
        ? [...new Set(chart.selectedValues.filter(v=>typeof v==="string").map(value=>chart.dimension==="__template"?groupedTemplateName(value):value))].slice(0,500) : []
    };
  }
  function loadConfig(config) {
    if (config && Array.isArray(config.charts)) {
      charts = config.charts.filter(c=>c && typeof c.id==="string").slice(0,80).map(normalChart);
      if(config.version!==2 && config.version!==3 && activeBoard.id!=="default") {
        for(const card of defaults.filter(item=>isRecent(item.type))) {
          if(charts.length<60 && !charts.some(item=>item.type===card.type))
            charts.push(normalChart(card));
        }
      }
    } else charts=activeBoard.id==="default"?[]:defaults.map(normalChart);
    if(activeBoard.id==="default") {
      const originalCards=[...overview].filter(([id])=>!charts.some(chart=>chart.id===id)).map(([id, item])=>
        normalChart({id,title:"",type:"overview",dimension:item.dimension,span:item.span}));
      charts=config?.version===3?[...charts,...originalCards]:[...originalCards,...charts];
      while(charts.length>80)charts.splice(charts.findLastIndex(chart=>!overview.has(chart.id)),1);
    }
  }
  let savedBoardState;
  function boardState() {
    return {name:activeBoard.name,visibility:activeBoard.visibility,charts:structuredClone(charts),vacantRows:[...vacantRows]};
  }
  function revertLayout() {
    if(!savedBoardState || saving || deleting || revision===savedRevision)return;
    closeEditor();
    activeBoard.name=savedBoardState.name;
    activeBoard.visibility=savedBoardState.visibility;
    charts=structuredClone(savedBoardState.charts);
    vacantRows.clear();
    for(const [row,height] of savedBoardState.vacantRows)vacantRows.set(row,height);
    tablePages.clear();
    revision=savedRevision;
    clearSavedFlash();
    syncBoardPicker();
    render();
    updateSaveBar(T("تم التراجع عن التعديلات","Changes reverted"));
    savedFlashTimer=setTimeout(()=>{
      if(revision===savedRevision && !saving && !deleting)updateSaveBar();
    },3000);
    $("dd-customize").focus({preventScroll:true});
  }
  function updateSaveBar(message) {
    const revert=$("dd-revert-layout");
    revert.classList.toggle("dd-hidden",revision===savedRevision);
    revert.disabled=!savedBoardState || saving || deleting || revision===savedRevision;
    $("dd-save-layout").classList.toggle("dd-hidden",revision===savedRevision);
    $("dd-save-layout").disabled=!layoutReady || saving || deleting || revision===savedRevision;
    for(const id of ["dd-board-list","dd-new-board","dd-rename-board"])
      $(id).disabled=!layoutReady || saving || deleting;
    // A board given through the Admin Portal is view only: only its creator changes it.
    $("dd-new-board").hidden=!canCreate;
    // Without «تخصيص اللوحة» the account only views: no customize, settings or delete button.
    $("dd-customize").hidden=!editable();
    $("dd-rename-board").hidden=!editable();
    $("dd-board-list").disabled||=activeBoard.none && boards.size===0;
    const note=$("dd-board-note");
    note.textContent=activeBoard.readOnly
      ? T("للعرض فقط · أنشأها ","View only · created by ")+(activeBoard.owner||"")
      : activeBoard.none&&layoutReady
        ? T("لا توجد لوحات متاحة لك في هذا المستودع. اطلبها من مسؤول بوابة الإدارة.",
            "No dashboards are available to you in this repository. Ask the Admin Portal administrator.")
        : "";
    note.hidden=!note.textContent;
    const custom=activeBoard.id!=="default" && editable();
    $("dd-delete-board").classList.toggle("dd-toolbar-hidden",!custom);
    $("dd-delete-board").disabled=!layoutReady || !custom || saving || deleting;
    $("dd-customize").disabled=deleting;
    $("dd-refresh").disabled=deleting;
    $("dd-repository").disabled=deleting;
    $("dd-layout-status").textContent=message ?? (saving?T("جارٍ الحفظ…","Saving…")
      :revision!==savedRevision?T("تغييرات غير محفوظة","Unsaved changes")
      :savedFlash&&!locked()?T("تم الحفظ","Saved"):"");
  }
  let savedFlashTimer;
  function clearSavedFlash() {
    clearTimeout(savedFlashTimer);
    savedFlash=false;
  }
  function markChanged() {
    clearSavedFlash();
    revision++;
    updateSaveBar();
  }
  function syncBoardPicker() {
    const items=[...boards.values()].filter(board=>board.id!==activeBoard.id);
    items.push(activeBoard);
    items.sort(boardOrder);
    const trigger=$("dd-board-list");
    const label=$("dd-board-current");
    // A given board carries its creator's name: two people may name boards alike.
    const name=board=>board.id==="default"?presetTitle(board.name)
      :board.readOnly?board.name+" · "+(board.owner||""):board.name;
    label.textContent=name(activeBoard);
    trigger.title=label.textContent;
    trigger.setAttribute("aria-label",T("اختيار اللوحة: ","Select dashboard: ")+label.textContent);
    const options=$("dd-board-options");
    options.replaceChildren(...items.map(board=>{
      const row=document.createElement("li");
      const button=document.createElement("button");
      button.type="button";
      button.className="dd-board-option";
      button.dataset.boardId=board.id;
      const icon=document.createElement("span");
      icon.className="dd-board-option-icon";
      const glyph=trigger.querySelector(".dd-board-icon").cloneNode(true);
      glyph.removeAttribute("class");
      icon.append(glyph);
      const text=document.createElement("span");
      text.className="dd-board-option-name";
      text.textContent=name(board);
      button.append(icon,text);
      if(choosesVisibility && visibilityOf(board)==="private") {
        const chip=document.createElement("span");
        chip.className="dd-board-private";
        chip.innerHTML=lockIcon;
        chip.append(T("خاصة","Private"));
        button.append(chip);
      }
      if(board.id===activeBoard.id) {
        button.setAttribute("aria-current","true");
        const badge=document.createElement("span");
        badge.className="dd-board-current-badge";
        badge.setAttribute("aria-hidden","true");
        badge.textContent=T("الحالية","Current");
        button.append(badge);
      }
      row.append(button);
      return row;
    }));
  }
  function rememberBoard() {
    const url=new URL(window.location.href);
    if(activeBoard.id==="default" || activeBoard.none)url.searchParams.delete("board");
    else url.searchParams.set("board",activeBoard.id);
    window.history.replaceState(window.history.state,"",url);
  }
  function activateBoard(board) {
    closeEditor();
    activeBoard={...board,visibility:visibilityOf(board)};
    if(!editable())editMode=false;
    // Empty rows saved by older versions are dropped: cards always move up into free space.
    vacantRows.clear();
    revision=0;
    savedRevision=0;
    clearSavedFlash();
    tablePages.clear();
    loadConfig(board.layout);
    savedBoardState=boardState();
    syncBoardPicker();
    updateSaveBar();
    render();
  }
  async function saveLayout() {
    if(revision===savedRevision)return true;
    if(!layoutReady || saving || deleting || !editable())return false;
    saving=true;
    const snapshot=revision;
    const layout={version:3,...boardState(),updatedAt:Date.now()};
    let message;
    updateSaveBar();
    try {
      const token=root.querySelector('input[name="__RequestVerificationToken"]')?.value;
      const response=await dashboardFetch("/DynamicDashboard/SaveLayout?boardId="+encodeURIComponent(activeBoard.id),{
        method:"POST",credentials:"same-origin",
        headers:{...requestHeaders,"Content-Type":"application/json","RequestVerificationToken":token||""},
        body:JSON.stringify(layout)
      });
      // 403: the Admin Portal does not let this account save it; the server says why.
      if(response.status===403) {
        message=(await response.json().catch(()=>null))?.error||T("لا توجد صلاحية لحفظ هذه اللوحة.","You may not save this dashboard.");
        return false;
      }
      if(!response.ok)throw new Error("HTTP "+response.status);
      savedRevision=snapshot;
      savedBoardState=layout;
      clearSavedFlash();
      savedFlash=true;
      savedFlashTimer=setTimeout(()=>{
        savedFlash=false;
        if(revision===savedRevision && !saving && !deleting)updateSaveBar();
      },3000);
      boards.set(activeBoard.id,{id:activeBoard.id,name:layout.name,layout});
      rememberBoard();
      return revision===savedRevision;
    } catch {
      message=T("تعذر الحفظ. حاول مرة أخرى.","Could not save. Try again.");
      return false;
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
      const response=await dashboardFetch("/DynamicDashboard/Layout",{credentials:"same-origin",cache:"no-store",headers:requestHeaders});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const result=await response.json();
      if(mainAllowed)boards.set(mainBoard.id,mainBoard);
      for(const board of result.boards)boards.set(board.id,board);
      const id=new URL(window.location.href).searchParams.get("board");
      layoutReady=true;
      activateBoard(boards.get(id)??fallbackBoard());
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
  function listValue(value) {
    return String(value).normalize("NFKC").replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu,"")
      .replace(/\s+/gu," ").trim();
  }
  const categoryValue=(id,value)=>value!==EMPTY_VALUE && isFieldDimension(id) && kind(id)==="list"
    ?listValue(value):value;
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
      ? value.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(v=>categoryValue(raw,String(v))).filter(Boolean) : [];
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
  function configuredListValues(dimension) {
    const options=fieldMeta(dimension)?.listValues;
    return kind(dimension)==="list" && Array.isArray(options)
      ? unique(options.filter(option=>typeof option==="string").map(listValue).filter(Boolean)):[];
  }
  function observedValues(dimension, source=fieldRows(dimension)) {
    const counts=new Map(configuredListValues(dimension).map(value=>[value,new Set()]));
    for(const row of source)
      for(const value of new Set(categoryKeys(row,dimension)))
        if(counts.has(value))counts.get(value).add(row.id);
        else counts.set(value,new Set([row.id]));
    return [...counts.entries()]
      .map(([value,ids])=>({value,count:ids.size,label:value===EMPTY_VALUE?T("بدون قيمة","No value"):value}))
      .sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,locale));
  }
  function isFieldDimension(dimension) {
    return /^(?:\d+$|field:)/.test(dimension);
  }
  function fieldRows(dimension) {
    if(dimension==="__creator" && people)return rows.filter(row=>people.has(row.creator));
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
    const filter=new Set(chart.selectedValues.map(value=>categoryValue(chart.dimension,value)));
    return source.filter(row=>categoryKeys(row,chart.dimension).some(v=>filter.has(v)!==Boolean(chart.allValues)));
  }
  function templateFieldCategory(template,field,value) {
    const fieldLabel=fieldMeta(field)?.name ?? field;
    const valueLabel=value===EMPTY_VALUE?T("بدون قيمة","No value"):value;
    return {key:JSON.stringify([template,field,value]),template,field:fieldLabel,valueLabel,
      label:template+" · "+fieldLabel+" · "+valueLabel};
  }
  function canonicalColorKey(dimension,key) {
    if(isFieldDimension(dimension))return categoryValue(dimension,key);
    if(dimension==="__template" && key.startsWith("[")) {
      try {
        const [template,field,value]=JSON.parse(key);
        if(typeof field==="string" && typeof value==="string")
          return JSON.stringify([template,field,categoryValue(field,value)]);
      } catch {
        // A template total can have a label beginning with a bracket.
      }
    }
    return key;
  }
  function groupColor(chart,key) {
    const stored=Object.hasOwn(chart.colors,key)?key:Object.keys(chart.colors)
      .find(value=>canonicalColorKey(chart.dimension,value)===key);
    return stored===undefined?undefined:chart.colors[stored];
  }
  function summaryCategories(row,chart,selected,templateFields,valueFilters) {
    const emptyLabel=T("بدون قيمة","No value");
    return categoryKeys(row,chart.dimension).flatMap(key=>{
      if(selected.size && selected.has(key)===Boolean(chart.allValues))return [];
      const label=key===EMPTY_VALUE?(chart.dimension==="__template"?T("بدون قالب","No template"):emptyLabel):key;
      const fields=chart.dimension==="__template"?templateFields.get(key):null;
      if(!fields?.length)return [{key,label,template:chart.dimension==="__template"?label:null}];
      return fields.flatMap(field=>{
        if(!row.fields || !Object.hasOwn(row.fields,field))return [];
        const values=valuesFor(row,field);
        const allowed=valueFilters.get(JSON.stringify([key,field]));
        return unique(values.length?values:[EMPTY_VALUE])
          .filter(value=>!allowed || allowed.has(value))
          .map(value=>templateFieldCategory(label,field,value));
      });
    });
  }
  function summary(chart) {
    const source=selectedRows(chart);
    if(chart.type==="kpi")return {kpi:new Set(source.map(x=>x.id)).size,items:source,groups:[],extra:0};
    const map=new Map(),selected=new Set(chart.dimension==="__pages" && chart.pages!=null ? [] : chart.selectedValues.map(value=>categoryValue(chart.dimension,value)));
    const templateFields=new Map((chart.templateFields ?? []).map(item=>[item.template,item.fields]));
    const valueFilters=new Map((chart.templateValueFilters ?? []).map(rule=>
      [JSON.stringify([rule.template,rule.field]),new Set(rule.values.map(value=>categoryValue(rule.field,value)))]));
    for(const row of source) {
      for(const category of summaryCategories(row,chart,selected,templateFields,valueFilters)) {
        const {key}=category;
        if(!map.has(key))map.set(key,{...category,docs:[],ids:new Set()});
        const g=map.get(key);
        if(!g.ids.has(row.id)){g.ids.add(row.id);g.docs.push(row);}
      }
    }
    const addEmpty=category=>{
      if(!map.has(category.key))map.set(category.key,{...category,docs:[],ids:new Set()});
    };
    const configured=configuredListValues(chart.dimension);
    for(const value of configured) {
      if(!selected.size || selected.has(value)!==Boolean(chart.allValues))addEmpty({key:value,label:value});
    }
    let includesConfiguredOptions=configured.length>0;
    if(chart.dimension==="__template") {
      for(const [template,fieldIds] of templateFields) {
        if(selected.size && selected.has(template)===Boolean(chart.allValues))continue;
        for(const field of fieldIds) {
          const options=configuredListValues(field);
          if(options.length)includesConfiguredOptions=true;
          const allowed=valueFilters.get(JSON.stringify([template,field]));
          for(const value of options) {
            if(!allowed || allowed.has(value))addEmpty(templateFieldCategory(template,field,value));
          }
        }
      }
    }
    const list=[...map.values()].map(g=>({...g,value:g.ids.size}));
    if(chart.dimension==="__template" && templateFields.size) {
      list.sort((a,b)=>a.template.localeCompare(b.template,locale,{numeric:true}) ||
        (a.field??"").localeCompare(b.field??"",locale) || b.value-a.value || a.label.localeCompare(b.label,locale));
    } else if(chart.dimension==="__created"||chart.dimension==="__modified")
      list.sort((a,b)=>a.label.localeCompare(b.label));
    else list.sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,locale));
    const isChart=!includesConfiguredOptions && !isTable(chart.type) && !["doughnut","pie"].includes(chart.type);
    return {groups:isChart?list.slice(0,30):list,extra:isChart?Math.max(0,list.length-30):0,
      totalGroups:list.length,items:source};
  }
  function showNotice(message) {
    const notice=$("dd-notice");
    const host=document.querySelector("dialog[open]");
    if(host)host.append(notice);
    $("dd-notice-text").textContent=message;
    notice.hidden=false;
    notice.scrollIntoView({block:"nearest"});
  }

  // Asks before deleting; resolves true when the user confirms. The confirm button answers at once;
  // closing any other way (إلغاء, Esc) answers no. One question at a time, so a late close event
  // can never answer the next question.
  let confirmPending=false;
  function confirmDialog(title, message, action) {
    const dialog=$("dd-confirm-dialog"), accept=$("dd-confirm-accept");
    if(dialog.open || confirmPending)return Promise.resolve(false);
    confirmPending=true;
    $("dd-confirm-title").textContent=title;
    $("dd-confirm-text").textContent=message;
    accept.textContent=action;
    dialog.returnValue="cancel";
    dialog.showModal();
    return new Promise(resolve=>{
      const finish=answer=>{
        accept.removeEventListener("click",yes);
        dialog.removeEventListener("close",no);
        confirmPending=false;
        resolve(answer);
      };
      const yes=()=>finish(true);
      const no=()=>finish(false);
      accept.addEventListener("click",yes);
      dialog.addEventListener("close",no);
    });
  }

  async function openArchive(title, docs) {
    if (editMode) return;
    const ids = [...new Set(docs.map(doc => doc.id))];
    if (!ids.length) return;
    const entryIds=ids.join(",");
    if(entryIds.length>300000) {
      showNotice(T("عدد النتائج أكبر من سعة فتح الأرشيف دفعة واحدة. ضيّق التصفية.","Too many results to open at once. Narrow the filters."));
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
    if(!await confirmLeaving())return;
    root.appendChild(form);
    navigateApproved(()=>form.submit());
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
      if(activate)tablePages.set(chart.id,page);
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
          if(index===0 && item.field && chart.dimension==="__template")text.classList.add("dd-template-tag");
          if(chart.dimension==="__template" && index===0) {
            text.title=String(value);
            text.className="dd-template-value";
          }
          cell.appendChild(text);
        });
        if(!activate)continue;
        row.tabIndex=0;row.style.cursor="pointer";
        row.addEventListener("click",()=>activate(item));
        row.addEventListener("keydown",event=>{
          if(event.key==="Enter"||event.key===" "){event.preventDefault();activate(item);}
        });
      }
      nav.hidden=!activate || total===1;
      if(nav.hidden)return;
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
    show(activate?(tablePages.get(chart.id)||1):1);
  }

  function drawDocumentTable(body,chart,open=openArchive) {
    body.classList.add("dd-document-table");
    const modified=dateColumn(chart)==="modified" || !dateColumn(chart);
    const headers=[T("اسم المستند","Document name"),T("المجلد","Folder"),T("القالب","Template"),T("تاريخ الإنشاء","Date created"),
      ...(modified?[T("تاريخ التعديل","Date modified")]:[]),T("أنشأه","Created by"),T("عدد الصفحات","Page count")];
    const format=value=>dateStamp(value)?.toLocaleString(locale,{calendar:"gregory"})||"—";
    drawTable(body,chart,headers,documentRows(chart),row=>[row.name,row.folder||"—",row.template||"—",
      format(row.created),...(modified?[format(row.modified)]:[]),row.creator||"—",row.pages??"—"],
      row=>open(row.name,[row]));
  }

  function iconButton(title,symbol,handler) {
    const b=document.createElement("button");b.type="button";b.className="dd-icon-btn";
    b.textContent=symbol;b.title=title;b.setAttribute("aria-label",title);
    b.addEventListener("click",handler);return b;
  }
  function visibilityButton(hidden, handler) {
    const button=iconButton(hidden?T("إظهار الجدول","Show widget"):T("إخفاء الجدول","Hide widget"),"",handler);
    button.setAttribute("aria-pressed",String(hidden));
    button.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>'+(hidden?'<path d="m3 3 18 18"/>':'')+'</svg>';
    return button;
  }
  function desktopWidth(chart) {
    const type=displayType(chart);
    if(chart.width)return Math.max(minimumWidth(chart),chart.width);
    if(type==="documents" || isRecent(type))return desktopColumns;
    if(chart.span===12)return desktopColumns;
    return quarterWidth(chart)?2*(numberSpans.indexOf(chart.span)+1):5;
  }

  function minimumWidth(chart) {
    return quarterWidth(chart)?2:displayType(chart)==="documents" || isRecent(chart.type)?5:3;
  }
  function freezeSlots() {
    for(const item of charts) {
      const slot=desktopLayout.get(item.id);
      if(slot)item.slot={row:slot.row,column:slot.column};
    }
  }
  function arrangeDesktop(cards) {
    const occupied=[];
    const placements=new Map();
    function fits(row,column,width) {
      return column+width<=desktopColumns &&
        !occupied[row]?.slice(column,column+width).some(Boolean);
    }
    function place(chart,row,column,width) {
      occupied[row]??=Array(desktopColumns).fill(false);
      occupied[row].fill(true,column,column+width);
      placements.set(chart.id,{row,column,width});
    }
    // Keep explicitly placed cards in their saved slots before laying out the rest.
    for(const chart of cards) {
      const width=desktopWidth(chart);
      if(chart.slot && fits(chart.slot.row,chart.slot.column,width))
        place(chart,chart.slot.row,chart.slot.column,width);
    }
    let cursor=0;
    for(const chart of cards) {
      if(placements.has(chart.id))continue;
      const width=desktopWidth(chart);
      while(!fits(Math.floor(cursor/desktopColumns),cursor%desktopColumns,width))cursor++;
      place(chart,Math.floor(cursor/desktopColumns),cursor%desktopColumns,width);
      cursor+=width;
    }
    return compactDesktop(placements);
  }

  // Gravity: every card moves up, keeping its column, while the row above has room for it,
  // so a deleted, hidden or moved card never leaves an empty gap. Cards keep their order:
  // a card never jumps over another one, and rows left empty disappear.
  function compactDesktop(placements) {
    const occupied=[];
    const compacted=new Map();
    const free=(row,column,width)=>!occupied[row]?.slice(column,column+width).some(Boolean);
    const ordered=[...placements].sort(([,a],[,b])=>a.row-b.row || a.column-b.column);
    for(const [id,slot] of ordered) {
      let row=Math.min(slot.row,occupied.length);
      while(row>0 && free(row-1,slot.column,slot.width))row--;
      occupied[row]??=Array(desktopColumns).fill(false);
      occupied[row].fill(true,slot.column,slot.column+slot.width);
      compacted.set(id,{row,column:slot.column,width:slot.width});
    }
    return compacted;
  }

  function gridPosition(element,{row,column,width}) {
    element.style.setProperty("--dd-row",row+1);
    element.style.setProperty("--dd-column",column+1);
    element.style.setProperty("--dd-width",width);
  }

  function clearDropHighlight() {
    const grid=$("dd-grid");
    grid.querySelectorAll(".dd-drop-target,.dd-drop-displaced").forEach(card=>
      card.classList.remove("dd-drop-target","dd-drop-displaced"));
    const preview=grid.querySelector(".dd-drop-preview");
    if(preview)preview.hidden=true;
    grid.querySelector(".dd-drop-row-line")?.remove();
  }

  function clearDropSlots() {
    clearDropHighlight();
    $("dd-grid").querySelectorAll(".dd-empty-slot,.dd-drop-preview").forEach(node=>node.remove());
  }

  function showPlacement(plan) {
    clearDropHighlight();
    const grid=$("dd-grid");
    const preview=grid.querySelector(".dd-drop-preview");
    if(!preview)return;
    gridPosition(preview,plan.placed);
    preview.hidden=false;
    for(const card of grid.querySelectorAll(".dd-card")) {
      const id=card.dataset.id;
      if(plan.displaced?.includes(id))card.classList.add("dd-drop-displaced");
    }
  }

  function showDropSlots(chart) {
    if(!desktopGrid())return;
    const minimum=minimumWidth(chart),grid=$("dd-grid");
    const rowCount=Math.max(0,...[...desktopLayout.values()].map(slot=>slot.row+1),...[...vacantRows.keys()].map(row=>row+1));
    const preview=document.createElement("div");
    preview.className="dd-drop-preview";preview.hidden=true;grid.appendChild(preview);
    const occupied=Array.from({length:rowCount+1},()=>Array(desktopColumns).fill(false));
    for(const slot of desktopLayout.values())
      occupied[slot.row].fill(true,slot.column,slot.column+slot.width);
    for(let row=0;row<=rowCount && row<160;row++) {
      for(let start=0;start<desktopColumns;) {
        if(occupied[row][start]){start++;continue;}
        let end=start+1;
        while(end<desktopColumns && !occupied[row][end])end++;
        const column=start;
        start=end;
        if(end-column<minimum)continue;
        const zone=document.createElement("div");
        zone.className="dd-empty-slot"+(row===rowCount?" dd-drop-end":"");
        zone.setAttribute("aria-hidden","true");
        gridPosition(zone,{row,column,width:end-column});
        zone.dataset.row=row;
        zone.dataset.column=column;
        zone.dataset.width=end-column;
        grid.appendChild(zone);
      }
    }
  }

  function emptyPlacement(layout,sourceId,placed) {
    const next=new Map(layout);
    next.set(sourceId,placed);
    return {next,placed,insertedRow:null,resize:true};
  }

  function insertDropRow(layout,sourceId,placed) {
    const next=new Map([...layout].map(([id,slot])=>
      [id,slot.row>=placed.row?{...slot,row:slot.row+1}:slot]));
    return {...emptyPlacement(next,sourceId,placed),insertedRow:placed.row,addedRows:1};
  }

  function gapPlacement(gap,x,width) {
    const rect=gap.getBoundingClientRect();
    const capacity=Number(gap.dataset.width);
    const fitted=Math.min(capacity,width);
    const fromStart=getComputedStyle(gap).direction==="rtl"?rect.right-x:x-rect.left;
    const offset=Math.round(fromStart/rect.width*capacity-fitted/2);
    return {row:Number(gap.dataset.row),column:Number(gap.dataset.column)+
      Math.max(0,Math.min(capacity-fitted,offset)),width:fitted};
  }

  function bindCardDrag(handle,card,chart) {
    handle.addEventListener("pointerdown",start=>{
      if(!editMode || busy || deleting || saving || !start.isPrimary || start.button!==0)return;
      const grid=$("dd-grid");
      handle.setPointerCapture(start.pointerId);
      let ghost,plan,targetKey,frame=0;
      let pointer=start;
      const bounds=card.getBoundingClientRect();
      const offsetX=start.clientX-bounds.left,offsetY=start.clientY-bounds.top;
      function rowBoundary(x,y) {
        const gridRect=grid.getBoundingClientRect();
        if(x<gridRect.left || x>gridRect.right)return;
        const rows=new Map();
        for(const node of grid.querySelectorAll(".dd-card")) {
          const row=desktopLayout.get(node.dataset.id).row;
          const rect=node.getBoundingClientRect();
          const prior=rows.get(row);
          rows.set(row,prior?{top:Math.min(prior.top,rect.top),bottom:Math.max(prior.bottom,rect.bottom)}:rect);
        }
        let bottom=gridRect.top-12;
        for(const [row,rect] of [...rows].sort(([a],[b])=>a-b)) {
          if(y>=bottom && y<rect.top)return {row,top:(bottom+rect.top)/2,left:gridRect.left,width:gridRect.width};
          bottom=rect.bottom;
        }
      }
      function showDropRow(top,left,width) {
        const line=document.createElement("div");
        line.className="dd-drop-row-line";
        line.style.cssText="top:"+top+"px;left:"+left+"px;width:"+width+"px";
        grid.append(line);
      }
      function update() {
        const {clientX:x,clientY:y}=pointer;
        ghost.style.transform="translate3d("+(x-offsetX)+"px,"+(y-offsetY)+"px,0)";
        const hit=document.elementFromPoint(x,y);
        const target=hit?.closest("#dd-grid .dd-card");
        const gap=hit?.closest("#dd-grid .dd-empty-slot");
        const id=target?.dataset.id;
        const boundary=desktopGrid() && !target && !gap?rowBoundary(x,y):null;
        const openSlot=gap?gapPlacement(gap,x,desktopWidth(chart)):null;
        const key=boundary?"row:"+boundary.row:id===chart.id?null:id ??
          (openSlot?"gap:"+openSlot.row+":"+openSlot.column:null);
        if(key===targetKey) {
          const line=grid.querySelector(".dd-drop-row-line");
          if(line && boundary)line.style.top=boundary.top+"px";
          return;
        }
        targetKey=key;
        plan=null;
        ghost.classList.remove("dd-drop-unavailable");
        clearDropHighlight();
        if(!key)return;
        if(boundary) {
          plan=insertDropRow(desktopLayout,chart.id,{row:boundary.row,column:0,width:desktopWidth(chart)});
          showDropRow(boundary.top,boundary.left,boundary.width);
        } else if(desktopGrid()) {
          plan=id?planCardSwap(chart.id,id):emptyPlacement(desktopLayout,chart.id,openSlot);
          if(plan?.insertedRow!=null) {
            const rect=grid.getBoundingClientRect();
            const targetRect=target.getBoundingClientRect();
            const after=plan.insertedRow>desktopLayout.get(id).row;
            const rowCards=[...grid.querySelectorAll(".dd-card")]
              .filter(node=>desktopLayout.get(node.dataset.id).row===desktopLayout.get(id).row);
            const edge=after?Math.max(...rowCards.map(node=>node.getBoundingClientRect().bottom)):targetRect.top;
            showDropRow(edge+(after?4:-4),rect.left,rect.width);
          } else if(plan)showPlacement(plan);
        } else if(id)plan={id};
        if(plan)target?.classList.add("dd-drop-target");
      }
      function scrollNearEdge() {
        const margin=64,y=pointer.clientY;
        const available=window.innerHeight;
        const speed=y<margin?-Math.ceil((margin-y)/5):y>available-margin?Math.ceil((y-available+margin)/5):0;
        if(speed) {
          window.scrollBy(0,speed);
          update();
        }
        frame=requestAnimationFrame(scrollNearEdge);
      }
      function move(event) {
        if(event.pointerId!==start.pointerId)return;
        pointer=event;
        if(!ghost) {
          if(Math.hypot(event.clientX-start.clientX,event.clientY-start.clientY)<7)return;
          ghost=document.createElement("div");
          ghost.className="dd-drag-ghost";
          ghost.textContent=widgetTitle(chart);
          ghost.setAttribute("aria-hidden","true");
          ghost.style.width=bounds.width+"px";
          root.append(ghost);
          card.classList.add("is-dragging");
          showDropSlots(chart);
          frame=requestAnimationFrame(scrollNearEdge);
        }
        update();
      }
      function finish(event) {
        if(event.pointerId!==start.pointerId)return;
        handle.removeEventListener("pointermove",move);
        handle.removeEventListener("pointerup",finish);
        handle.removeEventListener("pointercancel",finish);
        handle.removeEventListener("lostpointercapture",finish);
        if(!ghost)return;
        if(event.type==="pointerup") {
          pointer=event;
          update();
        }
        cancelAnimationFrame(frame);
        ghost.remove();
        card.classList.remove("is-dragging");
        clearDropSlots();
        if(event.type!=="pointerup" || !plan || !editMode || busy || deleting || saving)return;
        const before=new Map([...grid.querySelectorAll(".dd-card")].map(node=>[node.dataset.id,node.getBoundingClientRect()]));
        if(plan.next)applyPlacement(plan);
        else swapCards(charts.findIndex(item=>item.id===chart.id),charts.findIndex(item=>item.id===plan.id));
        markChanged();render();
        if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
          for(const node of grid.querySelectorAll(".dd-card")) {
            const from=before.get(node.dataset.id),to=node.getBoundingClientRect();
            if(from && (from.left!==to.left || from.top!==to.top))
              node.animate([{transform:"translate("+(from.left-to.left)+"px,"+(from.top-to.top)+"px)"},
                {transform:"none"}],{duration:180,easing:"ease-out"});
          }
      }
      handle.addEventListener("pointermove",move);
      handle.addEventListener("pointerup",finish);
      handle.addEventListener("pointercancel",finish);
      handle.addEventListener("lostpointercapture",finish);
    });
  }

  function swapIntoSourceRow(layout,sourceId,targetId,minWidth) {
    const source=layout.get(sourceId),target=layout.get(targetId);
    const peers=[...layout].filter(([id,slot])=>id!==sourceId && slot.row===source.row)
      .sort(([,a],[,b])=>a.column-b.column);
    let best;
    for(let width=target.width;width>=minWidth(targetId);width--) {
      const first=Math.max(0,source.column+source.width-width);
      const last=Math.min(source.column,desktopColumns-width);
      for(let column=last;column>=first;column--) {
        const end=column+width;
        const overlaps=peers.filter(([,slot])=>slot.column<end && slot.column+slot.width>column);
        if(overlaps.some(([,slot])=>slot.column<column || slot.column+slot.width>end))continue;
        const needed=source.width+overlaps.reduce((total,[,slot])=>total+slot.width,0);
        if(needed>target.width || best && best.overlaps.length<=overlaps.length)continue;
        best={column,width,overlaps};
      }
    }
    if(!best)return null;

    const next=new Map(layout);
    const placed={row:target.row,column:target.column,width:source.width};
    next.set(sourceId,placed);
    next.set(targetId,{row:source.row,column:best.column,width:best.width});
    let column=target.column+source.width;
    for(const [id,slot] of best.overlaps) {
      next.set(id,{row:target.row,column,width:slot.width});
      column+=slot.width;
    }
    return {next,placed,insertedRow:null,displaced:[targetId,...best.overlaps.map(([id])=>id)],resize:true};
  }

  function dropPlacement(layout,sourceId,targetId,minWidth) {
    const source=layout.get(sourceId),target=layout.get(targetId);
    if(!source || !target || sourceId===targetId)return null;
    const track=[...layout].filter(([id,slot])=>id!==sourceId && slot.row===target.row)
      .sort(([,a],[,b])=>a.column-b.column);
    const index=track.findIndex(([id])=>id===targetId);
    const next=new Map(layout);
    const block=[track[index]];
    let start=index,end=index+1;
    let width=target.width;

    // A narrow target can be combined with adjacent cards, up to the source slot's capacity.
    while(width<source.width && target.width<source.width) {
      const after=track[end];
      if(!after || after[1].column!==target.column+width || width+after[1].width>source.width)break;
      block.push(after);
      width+=after[1].width;
      end++;
    }
    while(width<source.width && target.width<source.width) {
      const before=track[start-1];
      if(!before || before[1].column+before[1].width!==block[0][1].column || width+before[1].width>source.width)break;
      block.unshift(before);
      width+=before[1].width;
      start--;
    }

    const required=block.reduce((total,[id])=>total+minWidth(id),0);
    if(width<minWidth(sourceId) || required>source.width) {
      if(source.row!==target.row && target.width>source.width) {
        const swap=swapIntoSourceRow(layout,sourceId,targetId,minWidth);
        if(swap)return swap;
      }
      // Fit the two cards around the target without disturbing its neighbors.
      const left=track[index-1]?.[1];
      const start=left?left.column+left.width:0;
      const end=track[index+1]?.[1].column??desktopColumns;
      const sourceWidth=Math.min(source.width,end-start-minWidth(targetId));
      if(sourceWidth>=minWidth(sourceId)) {
        const targetWidth=Math.min(target.width,end-start-sourceWidth);
        const column=Math.max(start,Math.min(target.column,end-sourceWidth-targetWidth));
        const placed={row:target.row,column,width:sourceWidth};
        next.set(sourceId,placed);
        next.set(targetId,{row:target.row,column:column+sourceWidth,width:targetWidth});
        return {next,placed,insertedRow:null,displaced:[targetId],resize:true};
      }
      const row=target.row+Number(source.row<target.row);
      return insertDropRow(layout,sourceId,{
        row,column:Math.min(target.column,desktopColumns-source.width),width:source.width
      });
    }
    const placed={row:target.row,column:block[0][1].column,width:Math.min(source.width,width)};
    next.set(sourceId,placed);
    let column=source.column;
    let remaining=source.width;
    let remainingMinimum=required;
    for(const [id,slot] of block) {
      remainingMinimum-=minWidth(id);
      const fitted=Math.min(slot.width,remaining-remainingMinimum);
      next.set(id,{row:source.row,column,width:fitted});
      column+=fitted;
      remaining-=fitted;
    }
    return {next,placed,insertedRow:null,displaced:block.map(([id])=>id),resize:true};
  }

  function planCardSwap(sourceId,targetId) {
    const byId=new Map(charts.map(chart=>[chart.id,chart]));
    return dropPlacement(desktopLayout,sourceId,targetId,id=>minimumWidth(byId.get(id)));
  }

  function applyDesktopDrop(sourceId,targetId) {
    const plan=planCardSwap(sourceId,targetId);
    if(!plan)return false;
    applyPlacement(plan);
    return true;
  }

  function applyPlacement({next,insertedRow,addedRows,resize=false}) {
    if(insertedRow!==null) {
      for(const [row,height] of [...vacantRows].sort(([a],[b])=>b-a)) {
        if(row<insertedRow)continue;
        vacantRows.delete(row);
        vacantRows.set(row+addedRows,height);
      }
    }
    const rows=[...new Set([...next.values()].map(slot=>slot.row).concat([...vacantRows.keys()]))].sort((a,b)=>a-b);
    const positions=new Map(rows.map((row,index)=>[row,index]));
    for(const chart of charts) {
      const slot=next.get(chart.id);
      if(slot) {
        if(resize && slot.width!==desktopLayout.get(chart.id)?.width) {
          chart.width=slot.width;
          chart.span=slot.width===desktopColumns?12:6;
        }
        chart.slot={row:positions.get(slot.row),column:slot.column};
        vacantRows.delete(slot.row);
      }
    }
    const empty=[...vacantRows];
    vacantRows.clear();
    for(const [row,height] of empty)vacantRows.set(positions.get(row),height);
    charts.sort((a,b)=>(a.slot?.row??160)-(b.slot?.row??160) ||
      (a.slot?.column??0)-(b.slot?.column??0));
  }

  function drawCard(chart) {
    const type=displayType(chart);
    const ghost=Boolean(chart.hidden);
    const el=document.createElement("article");
    el.className="dd-card"+(ghost?" dd-ghost":"")+(chart.accent?" dd-accent-card":"");
    const documentTable=type==="documents" || isRecent(type);
    el.classList.toggle("dd-full-card",chart.span===12 || documentTable && !chart.width);
    el.classList.toggle("dd-quarter-card",quarterWidth(chart) && chart.span===3);
    el.classList.toggle("dd-number-card",quarterWidth(chart));
    el.classList.toggle("dd-graph",!isTable(type)&&type!=="kpi"&&type!=="overview");
    el.dataset.id=chart.id;
    gridPosition(el,desktopLayout.get(chart.id));
    const header=document.createElement("header");header.className="dd-card-head";
    const headText=document.createElement("div"),title=document.createElement("strong");
    title.textContent=chart.id.startsWith("base-")?presetTitle(widgetTitle(chart)):widgetTitle(chart);headText.appendChild(title);
    const sub=document.createElement("small");sub.className="dd-card-sub";
    sub.textContent=isTable(type)&&type!=="table"?T("قائمة المستندات","Document list"):(fieldMeta(chart.dimension)?.name||T("الوثائق","Documents"))+T(" · عدد الوثائق"," · Document count");
    headText.appendChild(sub);
    const actions=document.createElement("div");actions.className="dd-card-actions";
    if(editMode) {
      headText.classList.add("dd-drag-handle");
      const grip=iconButton(T("اسحب لتغيير المكان","Drag to reorder"),"⠿",()=>{});
      grip.classList.add("dd-drag-handle");
      bindCardDrag(grip,el,chart);
      bindCardDrag(headText,el,chart);
      grip.addEventListener("keydown",event=>{
        if(!["ArrowUp","ArrowDown"].includes(event.key))return;
        event.preventDefault();moveCard(chart.id,event.key==="ArrowUp"?-1:1);
        [...$("dd-grid").children].find(card=>card.dataset.id===chart.id)?.querySelector(".dd-drag-handle")?.focus();
      });
      actions.append(grip,

        iconButton(T("تعديل الجدول","Edit widget"),"⚙",()=>openEditor(chart.id)),
        iconButton(T("تبديل عرض الكرت","Change card width"),"⤢",
          ()=>setCardSpan(el,chart,nextCardSpan(chart))),
        iconButton(T("نقل لأعلى","Move up"),"↑",()=>moveCard(chart.id,-1)),
        iconButton(T("نقل لأسفل","Move down"),"↓",()=>moveCard(chart.id,1)),
        visibilityButton(ghost,
          ()=>{chart.hidden=!chart.hidden;markChanged();render();}),
        ...(activeBoard.id==="default" && overview.has(chart.id)?[]:[iconButton(T("حذف الجدول","Delete widget"),"×",async()=>{if(await confirmDialog(T("حذف الجدول","Delete widget"),T("حذف هذا الجدول من لوحتك؟","Delete this widget from your dashboard?"),T("حذف الجدول","Delete widget"))){
          // The cards below move up into the space it leaves (arrangeDesktop compacts).
          if(desktopLayout.has(chart.id) && desktopGrid())freezeSlots();
          tablePages.delete(chart.id);charts=charts.filter(c=>c.id!==chart.id);markChanged();render();}})])
      );
    }
    header.append(headText,actions);el.appendChild(header);
    const body=document.createElement("div");body.className="dd-visual";
    body.inert=editMode;
    el.appendChild(body);
    if(editMode)attachResize(el,chart);
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
        paintNativeGraph(chart,original.node);
      } else {
        body.textContent=T("لا تتوفر البيانات الأصلية حاليًا.","Original data is currently unavailable.");
      }
    } else {
      const graph=drawVisual(body,chart,type,openArchive);
      if(graph)instances.push(graph);
    }
    return el;
  }
  // Draws a widget's data: the board's cards and the live example in the table settings share it.
  // Returns the Chart it made, if any.
  function drawVisual(body,chart,type,open,preview=false) {
    if(type==="documents" || isRecent(type)) {
      drawDocumentTable(body,chart,open);
      return null;
    }
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
      if(chart.accent) {
        const emblem=document.createElement("span");emblem.className="dd-kpi-feature-icon";
        emblem.setAttribute("aria-hidden","true");
        emblem.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/></svg>';
        k.appendChild(emblem);
      }
      const value=document.createElement("strong");
      value.className="dd-kpi-number";
      value.textContent=Number(data.kpi).toLocaleString(locale);
      k.appendChild(value);
      const small=document.createElement("small");
      small.textContent=T("وثيقة مطابقة للقيم المعروضة","documents matching the displayed values");
      k.appendChild(small);
      const dateKey=dateColumn(chart);
      if(dateKey) {
        const days=data.items.map(row=>dayKey(dateStamp(row[dateKey]))).filter(Boolean).sort();
        const format=value=>value?new Date(value+"T00:00:00Z").toLocaleDateString(locale,{calendar:"gregory",timeZone:"UTC"}):"—";
        const range=document.createElement("div");
        range.className="dd-kpi-range";
        for(const [label,day] of [[T("من","From"),chart.from||days[0]],[T("إلى","To"),chart.to||days.at(-1)]]) {
          const item=document.createElement("span");
          const date=document.createElement("bdi");
          date.textContent=format(day);
          item.append(label+" ",date);
          range.appendChild(item);
        }
        k.appendChild(range);
      }
      body.appendChild(k);
      if(data.items.length) {
        k.tabIndex=0;
        k.setAttribute("role","button");
        k.style.cursor="pointer";
        k.addEventListener("click",()=>open(chart.title,data.items));
        k.addEventListener("keydown",event=>{
          if(event.key==="Enter"||event.key===" "){event.preventDefault();k.click();}
        });
      }
    } else if(chart.type==="table") {
      const byField=data.groups.some(group=>group.field);
      const headers=byField?[T("القالب","Template"),T("الحقل","Field"),T("القيمة","Value")]:
        [fieldMeta(chart.dimension)?.name||T("القيمة","Value")];
      drawTable(body,chart,[...headers,T("عدد الوثائق","Document count")],data.groups,
        group=>[...(byField?[group.template,group.field??"—",group.valueLabel??T("إجمالي القالب","Template total")]:[group.label]),
          group.value.toLocaleString(locale)],group=>open(group.label,group.docs));
    } else if(!window.Chart) {
      const p=document.createElement("p");p.textContent=T("مكتبة الرسم المحلي غير متاحة","The local chart library is unavailable.");body.appendChild(p);
    } else {
      const stage=document.createElement("div");stage.className="dd-chart-stage";
      const canvas=document.createElement("canvas");stage.appendChild(canvas);body.appendChild(stage);
      const type=chart.type==="horizontal"?"bar":chart.type, axis=chart.type==="horizontal";
      const circ=["doughnut","pie"].includes(type);
      // The example in the table settings keeps every value readable: the plot grows and scrolls.
      if(preview && !circ && data.groups.length>8) {
        const scroller=document.createElement("div");
        scroller.className="dd-example-scroll"+(axis?" dd-example-scroll-y":"");
        scroller.dir="ltr";
        stage.replaceWith(scroller);
        scroller.appendChild(stage);
        if(axis)stage.style.height=data.groups.length*30+"px";
        else stage.style.width=data.groups.length*56+"px";
      }
      const colors=data.groups.map((group,i)=>groupColor(chart,group.key) ??
        (type==="line"?palette[0]:palette[i%palette.length]));
      if(circ) {
        const layout=document.createElement("div");layout.className="dashboard-round-layout";
        stage.className="dashboard-round-stage";
        const legend=document.createElement("div");legend.className="dashboard-round-results";legend.dir=arabic?"rtl":"ltr";
        const grouped=data.groups.some(group=>group.field);
        const containers=new Map();
        const heading=(parent,text,className)=>{
          const label=document.createElement("p");
          label.textContent=text;
          label.className=className;
          parent.appendChild(label);
        };
        data.groups.forEach((group,index)=>{
          let parent=legend;
          if(grouped) {
            if(!containers.has(group.template)) {
              const section=document.createElement("section");
              heading(section,group.template,"dd-template-result-heading");
              legend.appendChild(section);
              containers.set(group.template,{section,fields:new Map()});
            }
            const {section,fields}=containers.get(group.template);
            if(group.field && !fields.has(group.field)) {
              const field=document.createElement("div");
              heading(field,group.field,"dd-template-result-field");
              section.appendChild(field);
              fields.set(group.field,field);
            }
            parent=fields.get(group.field) ?? section;
          }
          const btn=document.createElement("button");
          btn.type="button";
          btn.className="dashboard-round-row";
          const dot=document.createElement("span");dot.className="dashboard-round-dot";
          dot.style.backgroundColor=colors[index];
          const label=document.createElement("span");label.className="dashboard-round-label";
          label.textContent=grouped?(group.valueLabel??T("إجمالي القالب","Template total")):group.label;
          label.title=group.label;
          const count=document.createElement("strong");count.textContent=group.value.toLocaleString(locale);
          btn.append(dot,label,count);
          btn.addEventListener("click",()=>open(group.label,group.docs));
          parent.appendChild(btn);
        });
        layout.append(stage,window.dashboardRoundScroll(legend,arabic));
        body.appendChild(layout);
      }
      const contrast=chart.accent?"#e8f2fa":"#506678";
      const gridColor=chart.accent?"#ffffff22":"#eef1f6";
      const config={
        type,
        data:{labels:data.groups.map(group=>{
          const shorten=(label,limit)=>label.length>limit?label.slice(0,limit)+"…":label;
          if(group.field && !circ)return [group.template,shorten(group.field,32),shorten(group.valueLabel,36)];
          return shorten(group.label,52);
        }),datasets:[{
          label:T("عدد الوثائق","Document count"),data:data.groups.map(g=>g.value),
          borderColor:palette[0],backgroundColor:colors,
          ...(type==="line"?{pointBackgroundColor:colors,pointBorderColor:colors,
            segment:{borderColor:context=>colors[context.p1DataIndex]}}:{}),
          ...(circ?{radius:"96%"}:{}),
          fill:false,borderWidth:type==="line"?2:0,tension:.27,borderRadius:type==="bar"?4:0
        }]},
        options:{
          responsive:true,maintainAspectRatio:false,indexAxis:axis?"y":"x",
          plugins:{legend:{display:false},tooltip:{backgroundColor:"#0b1c49",callbacks:{
            title:items=>data.groups[items[0]?.dataIndex]?.label ?? "",
            label:item=>data.groups[item.dataIndex].value.toLocaleString(locale)
          }}},
          scales:circ?{}:{
            x:{grid:{display:axis,color:gridColor},ticks:{font:{size:14},color:contrast,maxRotation:30,autoSkip:true}},
            y:{beginAtZero:true,grid:{color:axis?"transparent":gridColor},ticks:{font:{size:14},color:contrast}}
          },
          onClick:(_,points)=>{const group=data.groups[points[0]?.index];if(group)open(group.label,group.docs);}
        }
      };
      return new Chart(canvas,config);
    }
    return null;
  }
  function swapCards(first,second) {
    const left=charts[first],right=charts[second];
    const slots=[desktopLayout.get(left.id),desktopLayout.get(right.id)];
    [charts[first],charts[second]]=[right,left];
    [right.slot,left.slot]=slots.map(slot=>slot?{row:slot.row,column:slot.column}:null);
  }
  function moveCard(id, offset) {
    const index=charts.findIndex(card=>card.id===id);
    if(index<0)return;
    if(desktopGrid()) {
      const order=[...desktopLayout].sort(([,a],[,b])=>a.row-b.row || a.column-b.column);
      const target=order[order.findIndex(([key])=>key===id)+offset];
      if(!target)return;
      if(!applyDesktopDrop(id,target[0]))return;
    } else {
      const target=index+offset;
      if(target<0 || target>=charts.length)return;
      swapCards(index,target);
    }
    markChanged();render();
  }
  function stepCardSpan(chart, direction, cycle=false) {
    const width=desktopWidth(chart);
    const minimum=minimumWidth(chart);
    if(cycle && width===desktopColumns)return minimum;
    return Math.max(minimum,Math.min(desktopColumns,width+direction));
  }
  function nextCardSpan(chart) { return stepCardSpan(chart,1,true); }

  function setCardSpan(card,chart,width,edge="end") {
    if(desktopWidth(chart)===width)return;
    const current=desktopLayout.get(chart.id);
    const oldWidth=desktopWidth(chart);
    chart.width=width;
    chart.span=width===desktopColumns?12:6;
    if(current && desktopGrid()) {
      freezeSlots();
      const peers=charts.filter(item=>desktopLayout.get(item.id)?.row===current.row)
        .sort((a,b)=>a.slot.column-b.slot.column);
      const desiredColumn=Math.max(0,Math.min(desktopColumns-width,
        current.column+(edge==="start"?oldWidth-width:0)));
      const overlaps=peers.some(item=>item!==chart && item.slot.column<desiredColumn+width &&
        item.slot.column+desktopWidth(item)>desiredColumn);
      const remaining=[...peers];
      if(!overlaps) {
        chart.slot={row:current.row,column:desiredColumn};
      } else {
        if(width>oldWidth) {
          let occupied=remaining.reduce((total,item)=>total+desktopWidth(item),0);
          for(const item of [...remaining].reverse()) {
            if(item===chart || occupied<=desktopColumns)continue;
            const size=desktopWidth(item);
            item.width=Math.max(minimumWidth(item),size-(occupied-desktopColumns));
            occupied-=size-item.width;
          }
          const overflow=[];
          for(const item of [...remaining].reverse()) {
            if(item===chart || occupied<=desktopColumns)continue;
            overflow.unshift(item);
            remaining.splice(remaining.indexOf(item),1);
            occupied-=desktopWidth(item);
          }
          if(overflow.length) {
            for(const item of charts)if(item.slot?.row>current.row)item.slot.row++;
            for(const [row,height] of [...vacantRows].sort(([a],[b])=>b-a)) {
              if(row<=current.row)continue;
              vacantRows.delete(row);
              vacantRows.set(row+1,height);
            }
            let column=0;
            for(const item of overflow) {
              item.slot={row:current.row+1,column};
              column+=desktopWidth(item);
            }
          }
        }
        let column=0;
        for(const item of remaining) {
          item.slot={row:current.row,column};
          column+=desktopWidth(item);
        }
      }
    }
    markChanged();render();
    const updated=[...$("dd-grid").children].find(widget=>widget.dataset.id===card.dataset.id);
    updated?.querySelector(".dd-resize-"+edge)?.focus({preventScroll:true});
  }
  function attachResize(card,chart) {
    attachResizeHandle(card,chart,"end");
    attachResizeHandle(card,chart,"start");
  }
  function attachResizeHandle(card,chart,edge) {
    const rtl=getComputedStyle(document.documentElement).direction==="rtl";
    const right=(edge==="start")===rtl;
    const handle=iconButton(right?T("تغيير العرض من اليمين","Resize from the right"):T("تغيير العرض من اليسار","Resize from the left"),"↔",
      event=>{if(event.detail===0)setCardSpan(card,chart,nextCardSpan(chart),edge);});
    handle.classList.add("dd-resize-handle","dd-resize-"+edge);
    card.appendChild(handle);
    handle.addEventListener("pointerdown",event=>{
      if(event.button!==0 || !event.isPrimary)return;
      event.preventDefault();
      handle.focus({preventScroll:true});
      handle.setPointerCapture(event.pointerId);
      const widths=Array.from({length:desktopColumns-minimumWidth(chart)+1},(_,i)=>i+minimumWidth(chart));
      const grid=$("dd-grid");
      const gap=parseFloat(getComputedStyle(grid).columnGap)||0;
      const gridWidth=grid.clientWidth;
      const widthFor=width=>(gridWidth+gap)*width/desktopColumns-gap;
      const preview=document.createElement("div");
      preview.className="dd-resize-preview dd-preview-"+edge;
      preview.setAttribute("aria-hidden","true");
      card.appendChild(preview);
      let nextSpan=desktopWidth(chart);
      const update=next=>{
        const distance=(next.clientX-event.clientX)*(right?1:-1);
        const target=widthFor(desktopWidth(chart))+distance;
        const width=Math.max(widthFor(widths[0]),Math.min(widthFor(widths.at(-1)),target));
        preview.style.setProperty("--dd-preview-width",width+"px");
        nextSpan=widths.reduce((closest,span)=>
          Math.abs(widthFor(span)-width)<Math.abs(widthFor(closest)-width)?span:closest,desktopWidth(chart));
      };
      const cleanup=()=>{
        handle.removeEventListener("pointermove",update);
        handle.removeEventListener("pointerup",finish);
        handle.removeEventListener("lostpointercapture",cleanup);
        preview.remove();
      };
      const finish=next=>{
        update(next);
        cleanup();
        setCardSpan(card,chart,nextSpan,edge);
      };
      update(event);
      handle.addEventListener("pointermove",update);
      handle.addEventListener("pointerup",finish,{once:true});
      handle.addEventListener("lostpointercapture",cleanup,{once:true});
    });
    handle.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight"].includes(event.key))return;
      event.preventDefault();
      setCardSpan(card,chart,stepCardSpan(chart,(event.key==="ArrowRight")===right?1:-1),edge);
    });
  }
  function render() {
    const scrollTop=window.scrollY;
    instances.forEach(c=>c.destroy());instances=[];
    root.classList.toggle("dd-edit-mode",editMode);
    $("dd-customize").textContent=editMode?T("إنهاء التخصيص","Finish customizing"):T("تخصيص اللوحة","Customize dashboard");
    $("dd-customize").setAttribute("aria-pressed",String(editMode));
    $("dd-add").classList.toggle("dd-toolbar-hidden",!editMode);
    overviewStorage.hidden=true;
    if(overviewAlert) {
      $("dd-grid").before(overviewAlert);
      overviewAlert.hidden=activeBoard.id!=="default";
    }
    for(const {node} of overview.values())if(node)overviewRoot.appendChild(node);
    const visible=charts.filter(chart=>editMode || !chart.hidden);
    desktopLayout=arrangeDesktop(visible);
    const grid=$("dd-grid");
    grid.replaceChildren(...visible.map(chart=>drawCard(chart)));
    if(desktopGrid()) {
      const occupied=new Set([...desktopLayout.values()].map(slot=>slot.row));
      for(const [row,height] of vacantRows) {
        if(occupied.has(row))continue;
        const space=document.createElement("div");
        space.className="dd-vacant-row";
        space.setAttribute("aria-hidden","true");
        space.style.gridRow=row+1;
        space.style.minHeight=height+"px";
        grid.appendChild(space);
      }
    }
    if(window.scrollY!==scrollTop)window.scrollTo({top:scrollTop,behavior:"instant"});
    $("dd-empty").classList.toggle("dd-hidden",charts.some(c=>!c.hidden)||editMode&&charts.length>0);
  }
  function valueChoices() {
    const target=$("dd-value-list");target.replaceChildren();
    if(!editing||!editing.dimension||editing.type==="overview")return;
    const term=$("dd-value-search").value.trim().toLocaleLowerCase();
    if(dateColumn(editing) || isRecent(editing.type) || editing.dimension==="__pages")return;
    const categories=observedValues(editing.dimension);
    const visible=categories.filter(x=>x.label.toLocaleLowerCase().includes(term));
    const selected=new Set(editing.selectedValues.map(value=>categoryValue(editing.dimension,value)));
    const toggle=$("dd-clear-values");
    const all=categories.length>0 && categories.every(category=>selected.has(category.value)!==Boolean(editing.allValues));
    toggle.textContent=all?T("إلغاء تحديد الكل","Clear all"):T("اختيار الكل","Select all");
    toggle.dataset.allSelected=String(all);
    toggle.disabled=!categories.length;
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
        const set=new Set(editing.selectedValues.map(value=>categoryValue(editing.dimension,value)));
        if(check.checked!==editing.allValues)set.add(category.value);else set.delete(category.value);
        editing.selectedValues=[...set];updateEditorSource();valueChoices();
      });
      const text=document.createElement("span");text.textContent=category.label;
      const count=document.createElement("small");
      count.textContent=category.count.toLocaleString(locale)+T(" وثيقة"," documents");
      label.append(check,text,count);target.appendChild(label);
    }
  }
  function renderColorChoices() {
    const target=$("dd-color-list");
    target.replaceChildren();
    const graph=editing.type==="overview"?nativeGraph(editing):null;
    const visible=Boolean(graph || isGraph(editing.type)&&editing.dimension);
    $("dd-chart-colors").classList.toggle("dd-hidden",!visible);
    if(!visible)return;
    const choices=graph
      ? graph.data.datasets.flatMap((set,index)=>graph.data.labels.map(label=>({
          key:nativeKey(label,index),label:graph.data.datasets.length>1?set.label+" · "+label:String(label)
        })))
      : summary({...editing,from:$("dd-modified-from").value,to:$("dd-modified-to").value,
          pages:pageCount($("dd-pages").value)}).groups;
    const term=$("dd-color-search").value.trim().toLocaleLowerCase();
    const filtered=choices.filter(choice=>choice.label.toLocaleLowerCase().includes(term));
    filtered.forEach(({key,label},rowIndex)=>{
      const row=document.createElement("div");row.className="dd-value-option dd-color-option";
      const name=document.createElement("span");name.textContent=label;
      const options=document.createElement("div");options.className="dd-color-swatches";
      options.setAttribute("role","group");options.setAttribute("aria-label",label);
      for(const [index,color] of ["",...palette].entries()) {
        const input=document.createElement("input");
        input.type="radio";
        input.name="dd-color-value-"+rowIndex;
        input.className="dd-color-swatch";
        input.title=color?colorNames[index-1]:T("تلقائي","Automatic");
        input.setAttribute("aria-label",input.title);
        input.checked=color===((graph?editing.colors[key]:groupColor(editing,key)) ?? "");
        if(color)input.style.setProperty("--dd-swatch",color);
        else input.classList.add("dd-color-auto");
        input.addEventListener("change",()=>{
          if(!graph)for(const stored of Object.keys(editing.colors)) {
            if(canonicalColorKey(editing.dimension,stored)===key)delete editing.colors[stored];
          }
          if(color)Object.defineProperty(editing.colors,key,{value:color,writable:true,enumerable:true,configurable:true});
          else delete editing.colors[key];
          updateEditorSave();
        });
        options.appendChild(input);
      }
      row.append(name,options);target.appendChild(row);
    });
  }
  const editorFields=["dd-title","dd-type","dd-card-style","dd-dimension","dd-field","dd-modified-from","dd-modified-to","dd-pages"];
  const editorSnapshot=()=>JSON.stringify([editorFields.map(id=>$(id).value),editing.allValues,editing.selectedValues,editing.colors,editing.templateFields,editing.templateValueFilters]);
  let initialEditorSnapshot="", exampleKey="", rowsVersion=0;
  let exampleGraph=null;
  const EXAMPLE_ID="\u0000example";
  const GHOST=["#d4dee6","#e3eaf0","#eef2f5"];
  // The chosen display type's shape, grey and without numbers, until there is data to put in it.
  function drawExampleShape(body,type,hint) {
    body.classList.add("dd-example-shape");
    const shape=document.createElement("div");
    shape.className="dd-example-ghost";
    shape.setAttribute("aria-hidden","true");
    body.appendChild(shape);
    const bone=width=>{
      const line=document.createElement("span");
      line.className="dd-example-bone";
      line.style.inlineSize=width;
      return line;
    };
    let graph=null;
    if(isGraph(type) && window.Chart) {
      const stage=document.createElement("div");stage.className="dd-chart-stage";
      const canvas=document.createElement("canvas");stage.appendChild(canvas);
      const circ=type==="doughnut" || type==="pie", horizontal=type==="horizontal";
      if(circ) {
        stage.className="dashboard-round-stage";
        const layout=document.createElement("div");layout.className="dashboard-round-layout";
        const legend=document.createElement("div");legend.className="dashboard-round-results";
        ["80%","60%","70%"].forEach((width,index)=>{
          const row=document.createElement("div");row.className="dashboard-round-row";
          const dot=document.createElement("span");dot.className="dashboard-round-dot";
          dot.style.backgroundColor=GHOST[index];
          row.append(dot,bone(width),bone("14px"));
          legend.appendChild(row);
        });
        layout.append(stage,legend);
        shape.appendChild(layout);
      } else shape.appendChild(stage);
      const axis={ticks:{display:false},border:{display:false},grid:{color:GHOST[2]}};
      graph=new Chart(canvas,{
        type:horizontal?"bar":type,
        data:{labels:circ?["","",""]:["","","",""],datasets:[{data:circ?[5,3,2]:[6,9,4,7],
          backgroundColor:circ?GHOST:GHOST[1],borderColor:GHOST[0],borderWidth:type==="line"?2:0,
          pointBackgroundColor:GHOST[0],pointRadius:type==="line"?3:0,borderRadius:type==="bar"||horizontal?4:0,
          fill:false,tension:.27,...(circ?{radius:"96%"}:{})}]},
        options:{responsive:true,maintainAspectRatio:false,animation:false,events:[],indexAxis:horizontal?"y":"x",
          plugins:{legend:{display:false},tooltip:{enabled:false}},
          scales:circ?{}:{x:{...axis,grid:{display:horizontal,color:GHOST[2]}},
            y:{...axis,beginAtZero:true,grid:{display:!horizontal,color:GHOST[2]}}}}
      });
    } else if(type==="kpi") {
      const k=document.createElement("div");k.className="dd-kpi";
      const value=document.createElement("strong");value.className="dd-kpi-number";value.textContent="—";
      const small=document.createElement("small");
      small.textContent=T("وثيقة مطابقة للقيم المعروضة","documents matching the displayed values");
      k.append(value,small);
      shape.appendChild(k);
    } else {
      const documents=type==="documents" || isRecent(type);
      const wrap=document.createElement("div");wrap.className="dd-table-wrap";
      const table=document.createElement("table");table.className="dd-table";
      const head=table.createTHead().insertRow();
      for(const label of documents?[T("اسم المستند","Document name"),T("التاريخ","Date")]
        :[T("القيمة","Value"),T("عدد الوثائق","Document count")]) {
        const th=document.createElement("th");th.textContent=label;head.appendChild(th);
      }
      const tbody=table.createTBody();
      for(const width of ["70%","55%","62%"]) {
        const row=tbody.insertRow();
        row.insertCell().appendChild(bone(width));
        row.insertCell().appendChild(bone("24px"));
      }
      wrap.appendChild(table);
      shape.appendChild(wrap);
    }
    const note=document.createElement("p");
    note.className="dd-example-hint";
    note.textContent=hint;
    body.appendChild(note);
    return graph;
  }
  // «مثال على شكل العرض»: the widget as it will be saved, drawn from the documents this board has
  // read, so it follows every choice. Before «التجميع حسب» is chosen it is the type's empty shape.
  function renderEditorExample() {
    if(!editing)return;
    const type=editing.type;
    const dated=Boolean(dateColumn(editing));
    const draft={...editing,id:EXAMPLE_ID,accent:false,
      from:dated?$("dd-modified-from").value:"",to:dated?$("dd-modified-to").value:"",
      pages:editing.dimension==="__pages"?pageCount($("dd-pages").value):null};
    const shown=displayType(draft);
    const waiting=type!=="overview" && !isRecent(type) && !draft.dimension;
    const host=$("dd-editor-preview-card");
    const key=JSON.stringify([type,shown,waiting,draft.dimension,draft.allValues,draft.selectedValues,draft.colors,
      draft.templateFields,draft.templateValueFilters,draft.from,draft.to,draft.pages,rowsVersion]);
    if(key!==exampleKey) {
      exampleKey=key;
      exampleGraph?.destroy();
      exampleGraph=null;
      tablePages.delete(EXAMPLE_ID);
      const head=document.createElement("div");head.className="dd-example-head";
      head.append(document.createElement("strong"),document.createElement("small"));
      const body=document.createElement("div");body.className="dd-visual dd-example-visual";
      host.replaceChildren(head,body);
      const listed=shown==="documents" || isRecent(shown);
      const data=waiting || listed || type==="overview"?null:summary(draft);
      const empty=Boolean(data) && type!=="kpi" && type!=="table" && !data.groups.length;
      host.classList.toggle("dd-example-waiting",waiting || empty);
      if(type==="overview") {
        body.textContent=T("يعرض هذا الخيار شكل البطاقة الأصلي.","This option uses the widget’s original layout.");
      } else if(waiting || empty) {
        exampleGraph=drawExampleShape(body,shown,waiting
          ?T("اختر «التجميع حسب» لتمتلئ المعاينة ببيانات المستودع.","Choose «Group by» to fill the example with repository data.")
          :T("لا توجد وثائق مطابقة لهذه الاختيارات.","No documents match these choices."));
      } else {
        exampleGraph=drawVisual(body,draft,shown,()=>{},true);
        const documents=new Set((listed?documentRows(draft):data.items).map(row=>row.id)).size;
        const live=document.createElement("small");
        live.className="dd-example-live";
        live.textContent=T("من بيانات المستودع","From repository data")
          +(data && type!=="kpi"?T(" · القيم: "," · Values: ")+data.totalGroups.toLocaleString(locale):"")
          +T(" · الوثائق: "," · Documents: ")+documents.toLocaleString(locale);
        host.appendChild(live);
      }
    }
    // The name changes as it is typed, without drawing the example again.
    const [title,sub]=host.querySelector(".dd-example-head").children;
    title.textContent=$("dd-title").value.trim() || T("جدول بدون اسم","Untitled table");
    sub.textContent=type==="overview"?"":isTable(shown) && shown!=="table"?T("قائمة المستندات","Document list")
      :(fieldMeta(draft.dimension)?.name || "—")+T(" · عدد الوثائق"," · Document count");
  }
  function updateEditorSave() {
    if(!editing)return;
    const snapshot=editorSnapshot();
    $("dd-save").disabled=(!isRecent(editing.type) && editing.type!=="overview" && !editing.dimension)
      || (snapshot===initialEditorSnapshot && charts.some(chart=>chart.id===editing.id));
    for(const button of $("dd-editoroverlay").querySelectorAll("[data-editor-type]")) {
      const option=[...$("dd-type").options].find(option=>option.value===button.dataset.editorType);
      button.hidden=option.hidden;
      button.disabled=option.disabled;
      button.setAttribute("aria-pressed",String(option.selected));
    }
    if($("dd-editoroverlay").open)renderEditorExample();
  }
  function renderFieldValuePicker(target,template,field,source) {
    target.replaceChildren();
    const id=String(field.id);
    const groups=observedValues(id,source.filter(row=>row.fields && Object.hasOwn(row.fields,id)));
    const filters=editing.templateValueFilters ?? [];
    const saved=filters.find(rule=>rule.template===template && rule.field===id);
    let selected=new Set(saved?.values.map(value=>categoryValue(id,value)) ?? groups.map(group=>group.value));
    const title=document.createElement("p");
    title.className="dd-label";
    title.textContent=T("القيم الداخلة في المقارنة","Values included in comparison");
    const toggle=document.createElement("button");
    toggle.type="button";toggle.className="dd-btn";
    const list=document.createElement("div");
    list.className="dd-value-list";
    const checks=[];
    function update() {
      const all=groups.every(group=>selected.has(group.value));
      toggle.textContent=all?T("إلغاء اختيار الكل","Clear selection"):T("اختيار الكل","Select all");
      editing.templateValueFilters=(editing.templateValueFilters ?? [])
        .filter(rule=>rule.template!==template || rule.field!==id);
      if(!all)editing.templateValueFilters.push({template,field:id,values:[...selected]});
      renderColorChoices();
      updateEditorSave();
    }
    toggle.textContent=groups.every(group=>selected.has(group.value))?T("إلغاء اختيار الكل","Clear selection"):T("اختيار الكل","Select all");
    toggle.addEventListener("click",()=>{
      selected=groups.every(group=>selected.has(group.value))?new Set():new Set(groups.map(group=>group.value));
      checks.forEach((check,index)=>{check.checked=selected.has(groups[index].value);});
      update();
    });
    for(const group of groups) {
      const label=document.createElement("label");label.className="dd-value-option";
      const check=document.createElement("input");check.type="checkbox";check.checked=selected.has(group.value);
      check.addEventListener("change",()=>{
        if(check.checked)selected.add(group.value);
        else selected.delete(group.value);
        update();
      });
      const value=document.createElement("span");value.textContent=group.label;
      const count=document.createElement("small");count.textContent=group.count.toLocaleString(locale);
      checks.push(check);label.append(check,value,count);list.appendChild(label);
    }
    if(groups.length)target.append(title,toggle,list);
  }
  function renderTemplateFields() {
    const target=$("dd-template-fields");
    target.replaceChildren();
    const enabled=editing.dimension==="__template" && (editing.type==="table" || isGraph(editing.type));
    const selected=new Set(editing.selectedValues);
    const templates=enabled?observedValues("__template").filter(item=>item.value!==EMPTY_VALUE &&
      selected.has(item.value)!==Boolean(editing.allValues)):[];
    target.classList.toggle("dd-hidden",!templates.length);
    if(!templates.length)return;
    const title=document.createElement("p");
    title.className="dd-label";
    title.textContent=T("حقول القوالب المختارة (اختياري)","Fields from selected templates (optional)");
    target.appendChild(title);
    const available=new Map(templates.map(item=>[item.value,new Set()]));
    for(const row of rows) {
      const catalog=available.get(row.template);
      if(catalog)for(const field of Object.keys(row.fields ?? {}))catalog.add(field);
    }
    const rowsByTemplate=new Map(templates.map(item=>[item.value,[]]));
    for(const row of rows)rowsByTemplate.get(row.template)?.push(row);
    const selectedFields=new Map((editing.templateFields ?? []).map(item=>[item.template,new Set(item.fields)]));
    for(const template of templates) {
      const details=document.createElement("details");
      details.className="dd-template-field-group";
      const caption=document.createElement("summary");
      const choices=fields.filter(field=>available.get(template.value).has(String(field.id)));
      const picked=selectedFields.get(template.value) ?? new Set();
      const updateCaption=()=>{caption.textContent=template.label+(picked.size?" · "+picked.size.toLocaleString(locale):"");};
      updateCaption();
      details.open=true;
      details.appendChild(caption);
      if(!choices.length) {
        const empty=document.createElement("p");
        empty.className="dd-values-help";
        empty.textContent=T("لا توجد حقول متاحة من مستندات هذا القالب.","No fields are available from this template’s documents.");
        details.appendChild(empty);
      }
      for(const field of choices) {
        const label=document.createElement("label");
        label.className="dd-value-option";
        const checkbox=document.createElement("input");
        checkbox.type="checkbox";
        const id=String(field.id);
        checkbox.checked=picked.has(id);
        const values=document.createElement("div");
        values.className="dd-template-value-picker";
        if(checkbox.checked)renderFieldValuePicker(values,template.value,field,rowsByTemplate.get(template.value));
        checkbox.addEventListener("change",()=>{
          if(checkbox.checked)picked.add(id);
          else picked.delete(id);
          selectedFields.set(template.value,picked);
          editing.templateFields=[...selectedFields].filter(([,ids])=>ids.size)
            .map(([template,ids])=>({template,fields:[...ids]}));
          updateCaption();
          if(checkbox.checked)renderFieldValuePicker(values,template.value,field,rowsByTemplate.get(template.value));
          else values.replaceChildren();
          renderColorChoices();
          updateEditorSave();
        });
        label.append(checkbox,document.createTextNode(field.name));
        details.append(label,values);
      }
      target.appendChild(details);
    }
  }
  function openEditor(id) {
    if(!editMode || busy || deleting)return;
    if(id===null && charts.length>=80) {
      showNotice(T("الحد الأقصى 80 بطاقة لكل لوحة.","A dashboard can have up to 80 widgets."));
      return;
    }
    const item=charts.find(c=>c.id===id);
    editing=item?structuredClone(item):{
      id:"custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),
      title:T("جدول جديد","New table"),type:"table",dimension:"",
      wide:false,hidden:false,allValues:false,selectedValues:[],templateValueFilters:[],colors:{}
    };
    $("dd-overview-type").hidden=!editing.id.startsWith("overview-");
    $("dd-overview-type").disabled=$("dd-overview-type").hidden;
    $("dd-title").value=editing.id.startsWith("base-")?presetTitle(widgetTitle(editing)):widgetTitle(editing);$("dd-type").value=editing.type;
    $("dd-modified-from").value=editing.from||"";
    $("dd-modified-to").value=editing.to||"";
    $("dd-pages").value=editing.pages??"";
    $("dd-card-style").value=editing.accent?"accent":"standard";
    $("dd-filter-error").classList.add("dd-hidden");
    const isField=Boolean(editing.dimension) && !BUILTIN.some(f=>f.id===editing.dimension);
    selectOptions($("dd-dimension"),[
      ...BUILTIN.map(f=>({value:f.id,label:f.name})),
      {value:"__fields",label:T("حقول","Fields")}
    ],isField?"__fields":editing.dimension,T("اختر التجميع","Choose a grouping"));
    const fieldOptions=fields.map(f=>({value:String(f.id),label:f.name+(f.multi?T(" (قيم متعددة)"," (multiple values)"):"")}));
    if(isField&&!fieldOptions.some(f=>f.value===editing.dimension))
      fieldOptions.push({value:editing.dimension,label:T("حقل محفوظ (","Saved field (")+editing.dimension+")"});
    selectOptions($("dd-field"),fieldOptions,isField?editing.dimension:"",T("اختر الحقل","Select a field"));
    $("dd-value-search").value="";
    $("dd-color-search").value="";
    updateEditorSource();
    valueChoices();
    initialEditorSnapshot=editorSnapshot();
    updateEditorSave();
    $("dd-category-options").open=Boolean(editing.allValues || editing.selectedValues?.length);
    $("dd-chart-colors").open=false;
    $("dd-editor-preview-details").open=!window.matchMedia("(max-width: 700px)").matches;
    $("dd-editor-body").scrollTop=0;
    $("dd-editor-preview-details").parentElement.scrollTop=0;
    $("dd-editoroverlay").showModal();
    renderEditorExample();
    $("dd-title").focus({preventScroll:true});
  }
  function updateEditorSource() {
    const recent=isRecent(editing.type) || editing.type==="overview";
    const dateKey=dateColumn(editing);
    const usesField=$("dd-dimension").value==="__fields";
    $("dd-axis-options").classList.toggle("dd-hidden",recent);
    $("dd-editor-data-empty").classList.toggle("dd-hidden",!recent || Boolean(dateKey));
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
    $("dd-card-color").classList.toggle("dd-hidden",!quarterWidth(editing));
    const limit=$("dd-display-limit");
    limit.textContent=tooMany?T("الأعمدة متاحة حتى ١٠ وثائق ضمن نطاق التاريخ.","Bar charts are available for up to 10 documents in the date range."):"";
    limit.classList.toggle("dd-hidden",!limit.textContent);
    renderTemplateFields();
    renderColorChoices();
    updateEditorSave();
  }
  function changeDimension() {
    if(!editing)return;
    editing.dimension=$("dd-dimension").value==="__fields"?$("dd-field").value:$("dd-dimension").value;
    editing.selectedValues=[];
    editing.allValues=false;
    editing.colors={};
    $("dd-value-search").value="";
    updateEditorSource();
    valueChoices();
  }
  function closeEditor() {
    if(!$("dd-editoroverlay").open)return;
    $("dd-editoroverlay").close();
    exampleKey="";
    tablePages.delete(EXAMPLE_ID);
    exampleGraph?.destroy();
    exampleGraph=null;
    $("dd-editor-preview-card").replaceChildren();
    editing=null;
  }
  function saveEditor() {
    if(!editing)return;
    editing.title=$("dd-title").value.trim()||T("جدول بدون اسم","Untitled table");
    editing.type=$("dd-type").value;
    editing.accent=quarterWidth(editing) && $("dd-card-style").value==="accent";
    if($("dd-save").disabled)return;
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
    if(index>=0) {
      charts[index]=entry;
    } else {
      const occupiedRows=[...arrangeDesktop(charts).values()].map(slot=>slot.row);
      const lastRow=Math.max(-1,...occupiedRows,...vacantRows.keys());
      entry.slot={row:lastRow+1,column:0};
      charts.push(entry);
    }
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
      const records=await dashboardFetch("/DynamicDashboard/Rows",{credentials:"same-origin",cache:"no-store",headers:requestHeaders});
      if(records.status===409)throw new Error(T("تغيّرت الجلسة أو المستودع. أعد تحميل الصفحة.","The session or repository changed. Reload the page."));
      if(!records.ok)throw new Error([401,403].includes(records.status)
        ?T("لا توجد صلاحية لقراءة بيانات هذه الجلسة. سجل الدخول من جديد.","You cannot read data in this session. Sign in again.")
        :T("تعذر إكمال قراءة الوثائق والحقول من Laserfiche.","Could not finish reading documents and fields from Laserfiche."));
      const result=await records.json();
      if(!Array.isArray(result.fields)||!Array.isArray(result.rows))throw new Error(T("استجابة غير متوقعة من Laserfiche.","Unexpected response from Laserfiche."));
      fields=result.fields;rows=result.rows;partial=Boolean(result.fieldDataIncomplete);rowsVersion++;
      people=Array.isArray(result.people)?new Set(result.people):null;
      // The overview's «المستندات حسب نشاط المستخدم» counts these live documents (_Overview.cshtml).
      document.dispatchEvent(new CustomEvent("dd:rows",{detail:rows}));
      if(partial){
        $("dd-warning").textContent=T("بعض بيانات الحقول لم ترجع كاملة من Laserfiche. تعرض الجداول القيم المتاحة فقط.","Laserfiche returned incomplete field data. Widgets show available values only.");
        $("dd-warning").classList.remove("dd-hidden");
      }
      render();
      if($("dd-editoroverlay").open)renderEditorExample();
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
        const response=await dashboardFetch("/DynamicDashboard/Repositories",
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
      if(!await confirmLeaving())return;
      submit.disabled=true;
      message.textContent="";
      try {
        const response=await dashboardFetch(form.action,{
          method:"POST",credentials:"same-origin",headers:requestHeaders,body:new FormData(form)
        },true);
        const result=await response.json().catch(()=>({}));
        if(!response.ok || !result.url)throw new Error(result.error||T("تعذر تبديل المستودع.","Could not switch repositories."));
        navigateApproved(()=>window.location.assign(result.url));
      } catch(error) {
        password.value="";
        message.textContent=error.message;
        submit.disabled=false;
      }
    });
  }

  function confirmLeaving() {
    if(saving || deleting)return Promise.resolve(false);
    if(revision===savedRevision)return Promise.resolve(true);
    const dialog=$("dd-leave-dialog");
    if(dialog.open)return Promise.resolve(false);
    dialog.returnValue="cancel";
    $("dd-leave-save").disabled=!layoutReady;
    $("dd-leave-error").hidden=true;
    dialog.showModal();
    return new Promise(resolve=>{
      dialog.addEventListener("close",()=>resolve(dialog.returnValue==="discard" || dialog.returnValue==="saved"),{once:true});
    });
  }

  let approvedNavigation=false;
  function navigateApproved(callback) {
    approvedNavigation=true;
    callback();
  }
  function wireLeaveGuard() {
    const dialog=$("dd-leave-dialog");
    const save=$("dd-leave-save"),discard=$("dd-leave-discard"),cancel=$("dd-leave-cancel");
    dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
    save.addEventListener("click",async()=>{
      save.disabled=discard.disabled=cancel.disabled=true;
      const saved=await saveLayout();
      save.disabled=discard.disabled=cancel.disabled=false;
      if(saved)dialog.close("saved");
      else {
        const error=$("dd-leave-error");
        error.textContent=T("تعذر حفظ التغييرات. حاول مرة أخرى أو ابقَ في اللوحة.","Could not save the changes. Try again or stay on the dashboard.");
        error.hidden=false;
        save.focus();
      }
    });
    document.addEventListener("click",async event=>{
      const link=event.target.closest?.("a[href]");
      if(!link || event.defaultPrevented || revision===savedRevision ||
         event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
         link.hasAttribute("download") || (link.target && link.target!=="_self"))return;
      const url=new URL(link.href,location.href);
      if(!["http:","https:"].includes(url.protocol) ||
         (url.hash && url.origin===location.origin && url.pathname===location.pathname && url.search===location.search))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(await confirmLeaving()) {
        navigateApproved(()=>location.assign(url.href));
      }
    },true);
    // The main board's own widgets (_Overview.cshtml) open the archive through this, so unsaved
    // changes get this page's question instead of the browser's «Leave site?».
    window.dashboardLeave=async url=>{
      if(await confirmLeaving())navigateApproved(()=>location.assign(url));
    };
    window.addEventListener("beforeunload",event=>{
      if(approvedNavigation || revision===savedRevision)return;
      event.preventDefault();
      event.returnValue="";
    });
    window.addEventListener("pageshow",()=>{approvedNavigation=false;});
  }

  function wireBoards() {
    const dialog=$("dd-board-dialog");
    const name=$("dd-board-name");
    const list=$("dd-board-list");
    let creating=false;
    const menu=$("dd-board-menu");
    const picker=list.closest(".dd-board-picker");
    const options=()=>[...$("dd-board-options").querySelectorAll("button")];
    const closeMenu=(restoreFocus=false)=>{
      menu.hidden=true;
      list.setAttribute("aria-expanded","false");
      if(restoreFocus)list.focus();
    };
    function fitMenu() {
      menu.style.removeProperty("--dd-menu-shift");
      if(menu.hidden)return;
      const {left,right}=menu.getBoundingClientRect();
      const shift=Math.max(12-left,0)-Math.max(right-document.documentElement.clientWidth+12,0);
      menu.style.setProperty("--dd-menu-shift",shift+"px");
    }
    window.addEventListener("resize",fitMenu);
    const openMenu=()=>{
      if(list.disabled)return;
      menu.hidden=false;
      list.setAttribute("aria-expanded","true");
      fitMenu();
      (menu.querySelector('[aria-current="true"]') ?? options()[0])?.focus();
    };
    list.addEventListener("click",()=>menu.hidden?openMenu():closeMenu(true));
    menu.addEventListener("click",async event=>{
      const option=event.target.closest("button[data-board-id]");
      if(!option)return;
      const board=boards.get(option.dataset.boardId);
      closeMenu(true);
      if(list.disabled || !board || board.id===activeBoard.id || !await confirmLeaving())return;
      activateBoard(board);
      rememberBoard();
    });
    document.addEventListener("pointerdown",event=>{
      if(!menu.hidden && !picker.contains(event.target))closeMenu();
    });
    picker.addEventListener("focusout",event=>{
      if(!picker.contains(event.relatedTarget))closeMenu();
    });
    picker.addEventListener("keydown",event=>{
      if(event.key==="Escape" && !menu.hidden) {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
      event.preventDefault();
      if(menu.hidden) {
        openMenu();
        return;
      }
      const buttons=options();
      const index=buttons.indexOf(document.activeElement);
      const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:
        (index+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.focus();
    });
    const visibility=$("dd-board-visibility");
    const choices=()=>[...visibility.querySelectorAll('input[type="radio"]')];
    const chosen=()=>choices().find(input=>input.checked)?.value;
    visibility.addEventListener("change",()=>{ $("dd-board-error").textContent=""; });
    const open=async create=>{
      if(create ? !canCreate : !editable())return;
      if(create && !await confirmLeaving())return;
      creating=create;
      $("dd-board-dialog-title").textContent=create?T("لوحة جديدة","New dashboard"):T("تغيير اسم اللوحة","Rename dashboard");
      $("dd-board-error").textContent="";
      name.value=create?"":activeBoard.name;
      // Who sees a board is picked once, by its creator, with no ready answer. Renaming keeps it.
      visibility.hidden=!create || !choosesVisibility;
      for(const input of choices())input.checked=false;
      dialog.showModal();
      name.focus();
    };
    $("dd-new-board").addEventListener("click",()=>open(true));
    $("dd-delete-board").addEventListener("click",async()=>{
      const {id,name:boardName}=activeBoard;
      if(id==="default" || !editable() || !layoutReady || saving || deleting || busy)return;
      if(!await confirmDialog(T("حذف اللوحة","Delete dashboard"),T("حذف لوحة «","Delete dashboard “")+boardName+T("»؟","”?"),T("حذف اللوحة","Delete dashboard")))return;
      deleting=true;
      closeEditor();
      updateSaveBar(T("جارٍ حذف اللوحة…","Deleting dashboard…"));
      let message;
      try {
        if(boards.has(id)) {
          const token=root.querySelector('input[name="__RequestVerificationToken"]')?.value;
          const response=await dashboardFetch("/DynamicDashboard/DeleteLayout?boardId="+encodeURIComponent(id),{
            method:"POST",credentials:"same-origin",
            headers:{...requestHeaders,"RequestVerificationToken":token||""}
          });
          if(response.status===403) {
            const refusal=(await response.json().catch(()=>null))?.error;
            throw Object.assign(new Error(refusal||T("لا توجد صلاحية لحذف هذه اللوحة.","You may not delete this dashboard.")),{refused:true});
          }
          if(!response.ok)throw new Error("HTTP "+response.status);
        }
        boards.delete(id);
        editMode=false;
        activateBoard(fallbackBoard());
        rememberBoard();
        message=T("تم حذف اللوحة","Dashboard deleted");
      } catch(error) {
        message=error?.refused ? error.message
          : T("تعذر حذف اللوحة. حاول مرة أخرى.","Could not delete dashboard. Try again.");
      } finally {
        deleting=false;
        updateSaveBar(message);
        if(activeBoard.id==="default")list.focus();
      }
    });
    $("dd-rename-board").addEventListener("click",()=>open(false));
    $("dd-board-cancel").addEventListener("click",()=>dialog.close());
    dialog.querySelector("form").addEventListener("submit",event=>{
      event.preventDefault();
      const value=name.value.trim();
      if(!value) {
        $("dd-board-error").textContent=T("أدخل اسم اللوحة.","Enter a dashboard name.");
        return;
      }
      const choice=visibility.hidden?undefined:chosen();
      if(!visibility.hidden && !choice) {
        $("dd-board-error").textContent=T("اختر من يرى اللوحة.","Choose who can see the dashboard.");
        return;
      }
      if(creating) {
        const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),
          byte=>byte.toString(16).padStart(2,"0")).join("");
        editMode=true;
        activateBoard({id,name:value,visibility:choosesVisibility?choice:"private",layout:{version:3,charts:[]}});
        clearSavedFlash();
      } else activeBoard.name=value;
      syncBoardPicker();
      markChanged();
      dialog.close();
    });
  }
  // After a repository switch the other repository refused: say so once, and drop the note from
  // the address so a reload does not say it again.
  function showRefusedSwitch() {
    const dialog=$("dd-repository-refused-dialog");
    if(!dialog)return;
    const address=new URL(window.location.href);
    address.searchParams.delete("notInRepository");
    history.replaceState(history.state,"",address.pathname+address.search+address.hash);
    if(!dialog.open)dialog.showModal();
  }
  function wire() {
    showRefusedSwitch();
    wireRepositorySwitch();
    wireBoards();
    wireLeaveGuard();
    $("dd-save-layout").addEventListener("click",saveLayout);
    $("dd-revert-layout").addEventListener("click",revertLayout);
    window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload();});
    $("dd-refresh").addEventListener("click",refresh);
    $("dd-customize").addEventListener("click",()=>{
      if(!editable())return;
      editMode=!editMode;
      if(!editMode)closeEditor();
      render();
    });
    $("dd-add").addEventListener("click",()=>{ if(editMode && editable())openEditor(null); });
    $("dd-closeeditor").addEventListener("click",closeEditor);
    $("dd-cancel").addEventListener("click",closeEditor);
    $("dd-save").addEventListener("click",saveEditor);
    const editor=$("dd-editoroverlay");
    editor.addEventListener("cancel",event=>{
      event.preventDefault();
      closeEditor();
    });
    editor.addEventListener("click",event=>{
      if(event.target===editor)closeEditor();
    });
    editor.addEventListener("click",event=>{
      const button=event.target.closest("[data-editor-type]");
      if(!button || button.disabled)return;
      $("dd-type").value=button.dataset.editorType;
      $("dd-type").dispatchEvent(new Event("change"));
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
    $("dd-color-search").addEventListener("input",()=>{if(editing)renderColorChoices();});
    for(const id of ["dd-title","dd-card-style"])
      $(id).addEventListener("input",updateEditorSave);
    $("dd-pages").addEventListener("input",()=>{if(editing)updateEditorSource();});
    for(const id of ["dd-modified-from","dd-modified-to"])
      $(id).addEventListener("input",()=>{if(editing)updateEditorSource();});
    $("dd-clear-values").addEventListener("click",()=>{
      if(!editing||!editing.dimension)return;
      editing.allValues=$("dd-clear-values").dataset.allSelected!=="true";
      editing.selectedValues=[];
      $("dd-value-search").value="";
      updateEditorSource();
      valueChoices();
    });
  }
  loadConfig(mainAllowed?null:noBoard.layout);savedBoardState=boardState();wire();
  document.addEventListener("DOMContentLoaded",()=>restoreServerLayout().finally(refresh),{once:true});
})();
