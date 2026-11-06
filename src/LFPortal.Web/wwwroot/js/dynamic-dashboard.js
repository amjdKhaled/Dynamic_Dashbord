/* Dynamic Dashboard: no remote dependencies, no fabricated repository data. */
(() => {
  "use strict";
  const root = document.getElementById("dynamicDashboard");
  if (!root) return;
  const $ = id => document.getElementById(id);
  const requestHeaders = {"X-Dashboard-Repository":root.dataset.repository,"X-Dashboard-Layout-Scope":root.dataset.scope,"X-Requested-With":"XMLHttpRequest"};
  const BUILTIN = [
    {id:"__template",name:"القالب",type:"list"},
    {id:"__creator",name:"المستخدم / المنشئ",type:"list"},
    {id:"__created",name:"تاريخ الإضافة",type:"date"},
    {id:"__modified",name:"تاريخ التعديل",type:"date"},
    {id:"__folder",name:"المجلد",type:"list"},
    {id:"__pages",name:"عدد الصفحات",type:"number"}
  ];
  const palette = ["#0d3850","#60a2c4","#bf972c","#156083","#2b795b","#9eb0c1","#dcb455"];
  const defaults = [
    {id:"base-docs",title:"إجمالي الوثائق الظاهرة",type:"kpi",dimension:"__template",wide:false,hidden:false,selectedValues:[]},
    {id:"base-templates",title:"توزيع الوثائق حسب القالب",type:"doughnut",dimension:"__template",wide:false,hidden:false,selectedValues:[]},
    {id:"base-months",title:"الوثائق حسب تاريخ الإضافة",type:"line",dimension:"__created",wide:true,hidden:false,selectedValues:[]},
    {id:"base-users",title:"الوثائق حسب المستخدم",type:"bar",dimension:"__creator",wide:false,hidden:false,selectedValues:[]},
    {id:"base-recent-created",title:"المستندات المنشأة حديثًا",type:"recent-created",wide:true},
    {id:"base-recent-modified",title:"نشاط المستندات الأخير",type:"recent-modified",wide:true}
  ];
  const EMPTY_VALUE = "\u0000no-value";
  const validTypes = ["bar","horizontal","line","doughnut","pie","table","documents","kpi","recent-created","recent-modified"];
  const isRecent = type => type==="recent-created" || type==="recent-modified";
  const isTable = type => type==="table" || type==="documents" || isRecent(type);
  const dateColumn = chart => chart.type==="recent-modified" || (!isRecent(chart.type) && chart.dimension==="__modified")
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
  let partial = false, busy = false, editMode = false, revision = 0, savedRevision = 0, saving = false, hasSaved = false, layoutReady = false;

  function normalChart(chart) {
    const oldName = chart.dimension==="__name";
    const type = chart.type==="audit" ? "recent-modified" : chart.type;
    return {
      id:String(chart.id), title:String(chart.type==="audit" ? "نشاط المستندات الأخير" : chart.title||"شارت").slice(0,90),
      type:validTypes.includes(type)?type:"bar",
      dimension:oldName?"__template":String(chart.dimension||"__template"),
      wide:Boolean(chart.wide),
      span:chart.wide || Number(chart.span)>6 ? 12 : 6,
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
      charts = config.charts.filter(c=>c && typeof c.id==="string").slice(0,60).map(normalChart);
      hasSaved=true;
      if(config.version!==2) {
        for(const card of defaults.filter(item=>isRecent(item.type))) {
          if(charts.length<60 && !charts.some(item=>item.type===card.type))
            charts.push(normalChart(card));
        }
      }
    } else charts=defaults.map(normalChart);
  }
  function updateSaveBar(message) {
    $("dd-save-layout").disabled=!layoutReady || saving || revision===savedRevision;
    $("dd-layout-status").textContent=message ?? (saving?"جارٍ الحفظ…"
      :revision!==savedRevision?"تغييرات غير محفوظة"
      :hasSaved?"تم الحفظ":"");
  }
  function markChanged() {
    revision++;
    updateSaveBar();
  }
  async function saveLayout() {
    if(!layoutReady || saving || revision===savedRevision)return;
    saving=true;
    const snapshot=revision;
    updateSaveBar();
    try {
      const token=root.querySelector('input[name="__RequestVerificationToken"]')?.value;
      const response=await fetch("/DynamicDashboard/SaveLayout",{
        method:"POST",credentials:"same-origin",
        headers:{...requestHeaders,"Content-Type":"application/json","RequestVerificationToken":token||""},
        body:JSON.stringify({version:2,charts,updatedAt:Date.now()})
      });
      if(!response.ok)throw new Error("HTTP "+response.status);
      savedRevision=snapshot;
      hasSaved=true;
      updateSaveBar("تم الحفظ");
    } catch(error) {
      updateSaveBar("تعذر الحفظ. حاول مرة أخرى.");
    } finally {
      saving=false;
      $("dd-save-layout").disabled=revision===savedRevision;
    }
    if(savedRevision===snapshot)updateSaveBar();
  }
  async function restoreServerLayout() {
    if(!root.dataset.scope) {
      updateSaveBar("الحفظ يتطلب حساب Laserfiche معروف الهوية.");
      return;
    }
    try {
      const response=await fetch("/DynamicDashboard/Layout",{credentials:"same-origin",cache:"no-store",headers:requestHeaders});
      if(!response.ok)throw new Error("HTTP "+response.status);
      loadConfig(await response.json());
      layoutReady=true;
      updateSaveBar();
    } catch {
      updateSaveBar("تعذر تحميل اللوحة المحفوظة.");
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
  function observedValues(dimension, source=rows) {
    // Counts come from distinct readable documents, NOT a hardcoded list or field definition choices.
    const counts=new Map();
    for(const row of source)
      for(const value of new Set(categoryKeys(row,dimension)))
        counts.set(value,(counts.get(value)||0)+1);
    return [...counts.entries()]
      .map(([value,count])=>({value,count,label:value===EMPTY_VALUE?"بدون قيمة":value}))
      .sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,"ar"));
  }
  function fieldRows(dimension) {
    return /^\d+$/.test(dimension) ? rows.filter(row=>row.fields!=null) : rows;
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
        if(!map.has(key))map.set(key,{key,label:key===EMPTY_VALUE?"بدون قيمة":key,docs:[],ids:new Set()});
        const g=map.get(key);
        if(!g.ids.has(row.id)){g.ids.add(row.id);g.docs.push(row);}
      }
    }
    const list=[...map.values()].map(g=>({...g,value:g.ids.size}));
    if(chart.dimension==="__created"||chart.dimension==="__modified")
      list.sort((a,b)=>a.label.localeCompare(b.label));
    else list.sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,"ar"));
    const isChart=!isTable(chart.type);
    return {groups:isChart?list.slice(0,30):list,extra:isChart?Math.max(0,list.length-30):0,
      totalGroups:list.length,items:source};
  }
  function openArchive(title, docs) {
    const ids = [...new Set(docs.map(doc => doc.id))];
    if (!ids.length) return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = root.dataset.archiveUrl;
    for (const [name, value] of [
      ["__RequestVerificationToken", root.querySelector('input[name="__RequestVerificationToken"]').value],
      ["title", title.slice(0, 180)],
      ["repository", root.dataset.repository], ["entryIds", ids.join(",")]
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

  function displayType(chart, source=selectedRows(chart)) {
    if(dateColumn(chart))return isRecent(chart.type)?chart.type:"documents";
    return isBar(chart.type) && new Set(source.map(row=>row.id)).size>10 ? "documents" : chart.type;
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
    nav.setAttribute("aria-label","صفحات الجدول");
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
        cell.colSpan=headers.length;cell.textContent="لا توجد مستندات مطابقة.";
      }
      for(const item of rows.slice((page-1)*size,page*size)) {
        const row=tbody.insertRow();
        for(const value of cells(item))row.insertCell().textContent=value;
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
      button("السابق",page-1,page===1);
      const first=Math.max(1,Math.min(page-2,total-4));
      for(let index=first;index<=Math.min(total,first+4);index++) {
        const control=button(String(index),index,index===page);
        if(index===page)control.setAttribute("aria-current","page");
      }
      button("التالي",page+1,page===total);
      const input=document.createElement("input");
      input.type="number";input.min="1";input.max=String(total);input.value=String(page);
      input.setAttribute("aria-label","رقم الصفحة");
      const go=()=>{if(input.checkValidity() && input.value)show(Number(input.value));};
      const submit=iconButton("انتقال","انتقال",go);
      submit.className="dd-btn";
      input.addEventListener("keydown",event=>{if(event.key==="Enter")go();});
      nav.append(input,submit);
      nav.append("من "+total);
    }
    show(tablePages.get(chart.id)||1);
  }

  function drawDocumentTable(body,chart) {
    const modified=dateColumn(chart)==="modified" || !dateColumn(chart);
    const headers=["اسم المستند","المجلد","القالب","تاريخ الإنشاء",
      ...(modified?["تاريخ التعديل"]:[]),"أنشأه","عدد الصفحات"];
    const format=value=>dateStamp(value)?.toLocaleString("ar-SA",{calendar:"gregory"})||"—";
    drawTable(body,chart,headers,documentRows(chart),row=>[row.name,row.folder||"—",row.template||"—",
      format(row.created),...(modified?[format(row.modified)]:[]),row.creator||"—",row.pages??"—"],
      row=>openArchive(row.name,[row]));
  }

  function iconButton(title,symbol,handler) {
    const b=document.createElement("button");b.type="button";b.className="dd-icon-btn";
    b.textContent=symbol;b.title=title;b.setAttribute("aria-label",title);
    b.addEventListener("click",handler);return b;
  }
  function drawCard(chart, fullWidth) {
    const type=displayType(chart);
    const ghost=Boolean(chart.hidden);
    const el=document.createElement("article");
    el.className="dd-card"+(fullWidth?" dd-full-card":"")+(ghost?" dd-ghost":"");
    el.classList.toggle("dd-graph",!isTable(type)&&type!=="kpi");
    el.dataset.id=chart.id;el.draggable=editMode;
    const header=document.createElement("header");header.className="dd-card-head";
    const headText=document.createElement("div"),title=document.createElement("strong");
    title.textContent=chart.title;headText.appendChild(title);
    const sub=document.createElement("small");sub.className="dd-card-sub";
    sub.textContent=isTable(type)&&type!=="table"?"جدول الوثائق":(fieldMeta(chart.dimension)?.name||"الوثائق")+" · عدد الوثائق";
    headText.appendChild(sub);
    const actions=document.createElement("div");actions.className="dd-card-actions";
    if(editMode) {
      actions.append(
        iconButton("تعديل الشارت","⚙",()=>openEditor(chart.id)),
        ...(!isTable(type) ? [iconButton(chart.wide?"نصف العرض":"عرض كامل","⤢",()=>{
          chart.wide=!chart.wide;chart.span=chart.wide?12:6;markChanged();render();
        })] : []),
        iconButton("نقل لأعلى","↑",()=>moveCard(chart.id,-1)),
        iconButton("نقل لأسفل","↓",()=>moveCard(chart.id,1)),
        iconButton(ghost?"إظهار الشارت":"إخفاء الشارت",ghost?"◉":"◌",
          ()=>{chart.hidden=!chart.hidden;markChanged();render();}),
        iconButton("حذف الشارت","×",()=>{if(window.confirm("حذف هذا الشارت من لوحتك؟")){
          tablePages.delete(chart.id);charts=charts.filter(c=>c.id!==chart.id);markChanged();render();}})
      );
    }
    header.append(headText,actions);el.appendChild(header);
    const body=document.createElement("div");body.className="dd-visual";
    el.appendChild(body);
    if(ghost) {
      const text=document.createElement("p");text.className="dd-ghost-note";
      text.textContent="العنصر مخفي؛ اضغط زر العين لإظهاره";
      body.appendChild(text);
    } else if(type==="documents" || isRecent(type)) {
      drawDocumentTable(body,chart);
    } else {
      const data=summary(chart);
      const partialText=partial?"نتيجة جزئية من الوثائق المقروءة — ليست إجمالي المستودع":"";
      if(data.extra) {
        const note=document.createElement("small");note.className="dd-chart-note";
        note.textContent="عرض أول 30 فئة من "+data.totalGroups+"؛ اختر قيمًا محددة لعرض المزيد.";
        body.appendChild(note);
      }
      if(partialText) {
        const note=document.createElement("small");note.className="dd-chart-note dd-partial-note";
        note.textContent=partialText;body.appendChild(note);
      }
      if(chart.type==="kpi") {
        const k=document.createElement("div");k.className="dd-kpi";
        k.textContent=Number(data.kpi).toLocaleString("ar-SA");
        const small=document.createElement("small");
        small.textContent="وثيقة مطابقة للقيم المعروضة";
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
        drawTable(body,chart,[fieldMeta(chart.dimension)?.name||"القيمة","عدد الوثائق"],data.groups,
          group=>[group.label,group.value.toLocaleString("ar-SA")],
          group=>openArchive(group.label,group.docs));
      } else if(!window.Chart) {
        const p=document.createElement("p");p.textContent="مكتبة الرسم المحلي غير متاحة";body.appendChild(p);
      } else {
        const stage=document.createElement("div");stage.className="dd-chart-stage";
        const canvas=document.createElement("canvas");stage.appendChild(canvas);body.appendChild(stage);
        const type=chart.type==="horizontal"?"bar":chart.type, axis=chart.type==="horizontal";
        const circ=["doughnut","pie"].includes(type);
        if(circ) {
          body.classList.add("dd-circular-visual");
          const legend=document.createElement("div");legend.className="dd-chart-legend";
          for(let i=0;i<data.groups.length;i++) {
            const group=data.groups[i],btn=document.createElement("button");
            btn.type="button";btn.className="dd-legend-row";
            const dot=document.createElement("span");dot.className="dd-legend-dot";
            dot.style.backgroundColor=palette[i%palette.length];
            const label=document.createElement("span");label.textContent=group.label;
            const count=document.createElement("strong");count.textContent=group.value.toLocaleString("ar-SA");
            btn.append(dot,label,count);
            btn.addEventListener("click",()=>openArchive(group.label,group.docs));
            legend.appendChild(btn);
          }
          const shell=document.createElement("div");
          shell.className="dd-legend-shell";
          const scroll=direction=>legend.scrollBy({top:direction*48,behavior:"smooth"});
          const up=iconButton("تمرير القيم لأعلى","▲",()=>scroll(-1));
          const down=iconButton("تمرير القيم لأسفل","▼",()=>scroll(1));
          const updateArrows=()=>{
            up.disabled=legend.scrollTop<=1;
            down.disabled=legend.scrollTop+legend.clientHeight>=legend.scrollHeight-1;
          };
          legend.addEventListener("scroll",updateArrows,{passive:true});
          shell.append(up,legend,down);
          body.appendChild(shell);
          requestAnimationFrame(updateArrows);
        }
        const config={
          type,
          data:{labels:data.groups.map(g=>g.label),datasets:[{
            label:"عدد الوثائق",data:data.groups.map(g=>g.value),
            borderColor:palette[0],backgroundColor:type==="line"?palette[0]:data.groups.map((_,i)=>palette[i%palette.length]),
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
      if(!editMode || event.target.closest("button,select,input")) {event.preventDefault();return;}
      event.dataTransfer?.setData("text/plain",chart.id);
      if(event.dataTransfer)event.dataTransfer.effectAllowed="move";
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend",()=>el.classList.remove("is-dragging"));
    el.addEventListener("dragover",event=>{if(editMode)event.preventDefault();});
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
  function arrangedCards() {
    const visible=charts.filter(chart=>editMode || !chart.hidden);
    const full=chart=>chart.wide || isTable(displayType(chart));
    const result=[];
    for(let index=0;index<visible.length;index++) {
      const chart=visible[index], next=visible[index+1];
      if(full(chart) || !next || full(next))result.push(drawCard(chart,true));
      else {
        result.push(drawCard(chart,false),drawCard(next,false));
        index++;
      }
    }
    return result;
  }
  function render() {
    instances.forEach(c=>c.destroy());instances=[];
    root.classList.toggle("dd-edit-mode",editMode);
    $("dd-customize").textContent=editMode?"✓ إنهاء التخصيص":"⚙ تخصيص اللوحة";
    $("dd-customize").setAttribute("aria-pressed",String(editMode));
    $("dd-add").classList.toggle("dd-hidden",!editMode);
    $("dd-grid").replaceChildren(...arrangedCards());
    $("dd-empty").classList.toggle("dd-hidden",charts.some(c=>!c.hidden)||editMode&&charts.length>0);
  }
  function valueChoices() {
    const target=$("dd-value-list");target.replaceChildren();
    if(!editing||!editing.dimension)return;
    const term=$("dd-value-search").value.trim().toLocaleLowerCase();
    if(dateColumn(editing) || isRecent(editing.type) || editing.dimension==="__pages")return;
    const categories=observedValues(editing.dimension,fieldRows(editing.dimension));
    const visible=categories.filter(x=>x.label.toLocaleLowerCase().includes(term));
    const selected=new Set(editing.selectedValues);
    if(!visible.length || (visible.length===1 && visible[0].value===EMPTY_VALUE &&
        !BUILTIN.some(field=>field.id===editing.dimension))) {
      const p=document.createElement("p");p.className="dd-values-help";
      p.textContent=partial
        ?"لا توجد قيم ضمن الوثائق التي أمكن قراءتها؛ قد تكون البيانات غير مكتملة."
        :visible.length?"لا توجد قيم مقروءة لهذا الحقل ضمن الوثائق المتاحة."
        :"لا توجد قيم مطابقة للبحث في الوثائق المتاحة.";
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
      count.textContent=category.count.toLocaleString("ar-SA")+" وثيقة";
      label.append(check,text,count);target.appendChild(label);
    }
  }
  function openEditor(id) {
    if(!editMode || busy)return;
    const item=charts.find(c=>c.id===id);
    editing=item?structuredClone(item):{
      id:"custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),
      title:"شارت جديد",type:"table",dimension:"__template",
      wide:false,hidden:false,selectedValues:[]
    };
    $("dd-title").value=editing.title;$("dd-type").value=editing.type;
    $("dd-modified-from").value=editing.from||"";
    $("dd-modified-to").value=editing.to||"";
    $("dd-pages").value=editing.pages??"";
    $("dd-filter-error").classList.add("dd-hidden");
    const isField=Boolean(editing.dimension) && !BUILTIN.some(f=>f.id===editing.dimension);
    selectOptions($("dd-dimension"),[
      ...BUILTIN.map(f=>({value:f.id,label:f.name})),
      {value:"__fields",label:"حقول"}
    ],isField?"__fields":editing.dimension,null);
    const fieldOptions=fields.map(f=>({value:String(f.id),label:f.name+(f.multi?" (قيم متعددة)":"")}));
    if(isField&&!fieldOptions.some(f=>f.value===editing.dimension))
      fieldOptions.push({value:editing.dimension,label:"حقل محفوظ ("+editing.dimension+")"});
    selectOptions($("dd-field"),fieldOptions,isField?editing.dimension:"","اختر الحقل");
    $("dd-value-search").value="";
    updateEditorSource();
    valueChoices();
    $("dd-editoroverlay").classList.remove("dd-hidden");
  }
  function updateEditorSource() {
    const recent=isRecent(editing.type);
    const dateKey=dateColumn(editing);
    const usesField=$("dd-dimension").value==="__fields";
    $("dd-axis-options").classList.toggle("dd-hidden",recent);
    $("dd-field-options").classList.toggle("dd-hidden",!usesField || recent);
    $("dd-modified-range").classList.toggle("dd-hidden",!dateKey);
    $("dd-page-count").classList.toggle("dd-hidden",recent || editing.dimension!=="__pages");
    $("dd-category-options").classList.toggle("dd-hidden",recent || Boolean(dateKey) || editing.dimension==="__pages");
    const draft={...editing,pages:pageCount($("dd-pages").value)};
    const tooMany=Boolean(editing.dimension) && new Set(selectedRows(draft).map(row=>row.id)).size>10;
    for(const option of $("dd-type").options) {
      option.disabled=(isBar(option.value) && tooMany) ||
        (Boolean(dateKey) && !isRecent(option.value) && option.value!=="documents");
    }
    if($("dd-type").selectedOptions[0]?.disabled) {
      editing.type="documents";
      $("dd-type").value=editing.type;
    }
    const limit=$("dd-display-limit");
    limit.textContent=tooMany && !dateKey?"الأعمدة متاحة حتى ١٠ وثائق مطابقة.":"";
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
    editing.title=$("dd-title").value.trim()||"شارت بدون عنوان";
    editing.type=$("dd-type").value;
    if(!isRecent(editing.type)&&!editing.dimension)return;
    editing.from=dateColumn(editing)?$("dd-modified-from").value:"";
    editing.to=dateColumn(editing)?$("dd-modified-to").value:"";
    editing.pages=editing.dimension==="__pages"?pageCount($("dd-pages").value):null;
    const invalidRange=editing.from && editing.to && editing.from>editing.to;
    const invalidPages=!isRecent(editing.type) && editing.dimension==="__pages" && $("dd-pages").value.trim()!=="" && editing.pages===null;
    if(invalidRange || invalidPages) {
      const error=$("dd-filter-error");
      error.textContent=invalidRange?"تاريخ البداية يجب أن يسبق تاريخ النهاية أو يطابقه.":"أدخل رقمًا عشريًا أو صحيحًا يبدأ من صفر.";
      error.classList.remove("dd-hidden");
      return;
    }
    if(editing.dimension==="__pages" || dateColumn(editing)) {
      editing.selectedValues=[];
      editing.allValues=false;
    }
    editing.type=displayType(editing);
    tablePages.delete(editing.id);
    // Only store chosen category identifiers; aggregation always counts unique documents.
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
      const [catalog,records]=await Promise.all([
        fetch("/DynamicDashboard/Fields",{credentials:"same-origin",cache:"no-store",headers:requestHeaders}),
        fetch("/DynamicDashboard/Rows",{credentials:"same-origin",cache:"no-store",headers:requestHeaders})
      ]);
      if ([catalog.status,records.status].includes(409))
        throw new Error("تغيّر المستودع في تبويب آخر. أعد تحميل الصفحة.");
      if (!catalog.ok||!records.ok) throw new Error(
        [catalog.status,records.status].includes(401)||[catalog.status,records.status].includes(403)
          ?"لا توجد صلاحية لقراءة بيانات هذه الجلسة. سجل الدخول من جديد.":"تعذر قراءة بيانات المستودع من Laserfiche.");
      const defs=await catalog.json(),result=await records.json();
      if(!Array.isArray(defs)||!Array.isArray(result.rows))throw new Error("استجابة غير متوقعة من Laserfiche.");
      fields=defs;rows=result.rows;partial=Boolean(result.partial);
      if(partial){
        $("dd-warning").textContent=result.warning||"تنبيه: التحليل جزئي وليس إجمالي المستودع.";
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
    $("dd-repository").addEventListener("click",async()=>{
      password.value="";
      password.required=false;
      $("dd-repository-password-wrap").hidden=true;
      select.replaceChildren();
      submit.disabled=true;
      message.textContent="جارٍ قراءة المستودعات…";
      dialog.showModal();
      try {
        const response=await fetch("/DynamicDashboard/Repositories",
          {credentials:"same-origin",cache:"no-store",headers:requestHeaders});
        if(!response.ok)throw new Error();
        const result=await response.json();
        const choices=result.repositories.filter(item=>
          item.id.toLowerCase()!==root.dataset.repository.toLowerCase());
        selectOptions(select,choices.map(item=>({value:item.id,label:item.name||item.id})),
          "","اختر المستودع");
        $("dd-repository-password-wrap").hidden=!result.requiresPassword;
        password.required=Boolean(result.requiresPassword);
        message.textContent=choices.length?"":"لا توجد مستودعات أخرى في القائمة التي أعادها Laserfiche.";
        submit.disabled=!choices.length;
      } catch {
        message.textContent="تعذر قراءة المستودعات من Laserfiche.";
      }
    });
    $("dd-repository-cancel").addEventListener("click",()=>dialog.close());
    dialog.addEventListener("close",()=>{password.value="";});
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(saving || revision!==savedRevision && !window.confirm("توجد تغييرات غير محفوظة. تبديل المستودع؟"))return;
      submit.disabled=true;
      message.textContent="";
      try {
        const response=await fetch(form.action,{
          method:"POST",credentials:"same-origin",headers:requestHeaders,body:new FormData(form)
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok || !result.url)throw new Error(result.error||"تعذر تبديل المستودع.");
        window.location.assign(result.url);
      } catch(error) {
        password.value="";
        message.textContent=error.message;
        submit.disabled=false;
      }
    });
  }

  function wire() {
    wireRepositorySwitch();
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
    $("dd-pages").addEventListener("input",()=>{if(editing)updateEditorSource();});
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
  restoreServerLayout().finally(refresh);
})();
