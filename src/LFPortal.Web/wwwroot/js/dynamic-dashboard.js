/* Dynamic Dashboard: no remote dependencies, no fabricated repository data. */
(() => {
  "use strict";
  const root = document.getElementById("dynamicDashboard");
  if (!root) return;
  const $ = id => document.getElementById(id);
  const key = "lf-dynamic-dashboard-v1:" + root.dataset.scope;
  const BUILTIN = [
    {id:"__template",name:"القالب",type:"list"},
    {id:"__creator",name:"المستخدم / المنشئ",type:"list"},
    {id:"__created",name:"تاريخ الإضافة",type:"date"},
    {id:"__modified",name:"تاريخ التعديل",type:"date"},
    {id:"__name",name:"اسم الوثيقة",type:"text"},
    {id:"__folder",name:"المجلد",type:"list"},
    {id:"__pages",name:"عدد الصفحات",type:"number"}
  ];
  const palette = ["#0b1c49","#2367c6","#7f96a8","#4c8b72","#a4b5c6","#c8a55b","#64748b"];
  const defaults = [
    {id:"base-docs",title:"إجمالي الوثائق الظاهرة",type:"kpi",dimension:"__template",height:280,wide:false,hidden:false,selectedValues:[]},
    {id:"base-templates",title:"توزيع الوثائق حسب القالب",type:"doughnut",dimension:"__template",height:360,wide:false,hidden:false,selectedValues:[]},
    {id:"base-months",title:"الوثائق حسب تاريخ الإضافة",type:"line",dimension:"__created",height:340,wide:true,hidden:false,selectedValues:[]},
    {id:"base-users",title:"الوثائق حسب المستخدم",type:"bar",dimension:"__creator",height:320,wide:false,hidden:false,selectedValues:[]}
  ];
  const EMPTY_VALUE = "\u0000no-value";
  const validTypes = ["bar","horizontal","line","doughnut","pie","table","kpi"];
  let rows = [], fields = [], charts = [], instances = [], editing = null;
  let partial = false, busy = false, editMode = false, lastUpdated = 0, saveTimer = null;

  function normalChart(chart) {
    return {
      id:String(chart.id), title:String(chart.title||"شارت").slice(0,90),
      type:validTypes.includes(chart.type)?chart.type:"bar",
      dimension:String(chart.dimension||"__template"),
      wide:Boolean(chart.wide), height:Math.max(280,Math.min(620,Number(chart.height)||340)),
      hidden:Boolean(chart.hidden),
      selectedValues:Array.isArray(chart.selectedValues)
        ? [...new Set(chart.selectedValues.filter(v=>typeof v==="string"))].slice(0,500) : []
    };
  }
  function safeLocal(config) {
    // Browser preferences must not persist potentially sensitive document field values.
    return {updatedAt:config.updatedAt,
      charts:config.charts.map(c=>({...c,selectedValues:[]}))};
  }
  function loadConfig(config) {
    if (config && Array.isArray(config.charts)) {
      charts = config.charts.filter(c=>c && typeof c.id==="string").slice(0,60).map(normalChart);
      lastUpdated=Number(config.updatedAt)||0;
    } else charts=defaults.map(c=>normalChart(c));
  }
  function persist() {
    lastUpdated=Date.now();
    const config={charts,updatedAt:lastUpdated};
    try { localStorage.setItem(key,JSON.stringify(safeLocal(config))); }
    catch(_) {}
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer=setTimeout(async()=>{
      try {
        const token=root.querySelector('input[name="__RequestVerificationToken"]')?.value;
        const response=await fetch("/DynamicDashboard/SaveLayout",{
          method:"POST",credentials:"same-origin",
          headers:{"Content-Type":"application/json","RequestVerificationToken":token||""},
          body:JSON.stringify(config)
        });
        if(!response.ok)throw new Error("HTTP "+response.status);
      } catch(error) {
        $("dd-warning").textContent="تعذر حفظ التخصيص على الخادم. قد لا تُحفظ اختيارات قيم الحقول بعد إعادة التحميل.";
        $("dd-warning").classList.remove("dd-hidden");
        console.warn("Could not save dashboard layout",error);
      }
    },600);
  }
  async function restoreServerLayout() {
    let cached=null;
    try { cached=JSON.parse(localStorage.getItem(key)||"null"); } catch(_){}
    try {
      const response=await fetch("/DynamicDashboard/Layout",{credentials:"same-origin",cache:"no-store"});
      if(response.ok) {
        const remote=await response.json();
        if(Array.isArray(remote.charts)) { loadConfig(remote); return; }
      }
    } catch(_){}
    loadConfig(cached);
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
    if(raw==="__name")return row.name?[row.name]:[];
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
  function observedValues(dimension) {
    // Counts come from distinct readable documents, NOT a hardcoded list or field definition choices.
    const counts=new Map();
    for(const row of rows)
      for(const value of new Set(categoryKeys(row,dimension)))
        counts.set(value,(counts.get(value)||0)+1);
    return [...counts.entries()]
      .map(([value,count])=>({value,count,label:value===EMPTY_VALUE?"بدون قيمة":value}))
      .sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,"ar"));
  }
  function selectedRows(chart) {
    if(!chart.selectedValues.length)return rows;
    const filter=new Set(chart.selectedValues);
    return rows.filter(row=>categoryKeys(row,chart.dimension).some(v=>filter.has(v)));
  }
  function summary(chart) {
    const source=selectedRows(chart);
    if(chart.type==="kpi")return {kpi:new Set(source.map(x=>x.id)).size,items:source,groups:[],extra:0};
    const map=new Map(),selected=new Set(chart.selectedValues);
    for(const row of source) {
      for(const key of new Set(categoryKeys(row,chart.dimension))) {
        if(selected.size&&!selected.has(key))continue;
        if(!map.has(key))map.set(key,{key,label:key===EMPTY_VALUE?"بدون قيمة":key,docs:[],ids:new Set()});
        const g=map.get(key);
        if(!g.ids.has(row.id)){g.ids.add(row.id);g.docs.push(row);}
      }
    }
    const list=[...map.values()].map(g=>({...g,value:g.ids.size}));
    if(chart.dimension==="__created"||chart.dimension==="__modified")
      list.sort((a,b)=>a.label.localeCompare(b.label));
    else list.sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,"ar"));
    const isChart=chart.type!=="table";
    return {groups:isChart?list.slice(0,30):list,extra:isChart?Math.max(0,list.length-30):0,
      totalGroups:list.length,items:source};
  }
  function details(title,docs) {
    $("dd-details-title").textContent=title;
    const container=$("dd-details-content"); container.replaceChildren();
    const table=document.createElement("table");table.className="dd-table";
    const head=document.createElement("thead"),tr=document.createElement("tr");
    ["الوثيقة","القالب","تاريخ الإضافة"].forEach(t=>{const th=document.createElement("th");th.textContent=t;tr.appendChild(th);});
    head.appendChild(tr);table.appendChild(head);
    const body=document.createElement("tbody");
    const seen=new Set();
    for (const doc of docs) {
      if (seen.has(doc.id))continue;seen.add(doc.id);
      const row=document.createElement("tr"),a=document.createElement("a");
      a.href="/Archive?scope=document&entryId="+encodeURIComponent(doc.id);
      a.textContent=doc.name||String(doc.id);
      const c1=document.createElement("td");c1.appendChild(a);
      const c2=document.createElement("td");c2.textContent=doc.template||"—";
      const c3=document.createElement("td");c3.textContent=doc.created?dayKey(dateStamp(doc.created)):"—";
      row.append(c1,c2,c3);body.appendChild(row);
    }
    table.appendChild(body);container.appendChild(table);
    $("dd-details-overlay").classList.remove("dd-hidden");
  }
  function iconButton(title,symbol,handler) {
    const b=document.createElement("button");b.type="button";b.className="dd-icon-btn";
    b.textContent=symbol;b.title=title;b.setAttribute("aria-label",title);
    b.addEventListener("click",handler);return b;
  }
  function iconButton(title,symbol,handler) {
    const b=document.createElement("button");b.type="button";b.className="dd-icon-btn";
    b.textContent=symbol;b.title=title;b.setAttribute("aria-label",title);
    b.addEventListener("click",handler);return b;
  }
  function drawCard(chart) {
    const ghost=Boolean(chart.hidden);
    const el=document.createElement("article");
    el.className="dd-card"+(chart.wide?" wide":"")+(ghost?" dd-ghost":"");
    el.style.height=chart.height+"px";el.dataset.id=chart.id;el.draggable=editMode;
    const header=document.createElement("header");header.className="dd-card-head";
    const headText=document.createElement("div"),title=document.createElement("strong");
    title.textContent=chart.title;headText.appendChild(title);
    const sub=document.createElement("small");sub.className="dd-card-sub";
    sub.textContent=(fieldMeta(chart.dimension)?.name||"الوثائق")+" · عدد الوثائق";
    headText.appendChild(sub);
    const actions=document.createElement("div");actions.className="dd-card-actions";
    if(editMode) {
      actions.append(
        iconButton("تعديل الشارت","⚙",()=>openEditor(chart.id)),
        iconButton(chart.wide?"تصغير العرض":"توسيع العرض","⤢",()=>{chart.wide=!chart.wide;persist();render();}),
        iconButton(ghost?"إظهار الشارت":"إخفاء الشارت",ghost?"◉":"◌",
          ()=>{chart.hidden=!chart.hidden;persist();render();}),
        iconButton("حذف الشارت","×",()=>{if(window.confirm("حذف هذا الشارت من لوحتك؟")){
          charts=charts.filter(c=>c.id!==chart.id);persist();render();}}),
        iconButton("اسحب لتغيير الترتيب","⠿",()=>{})
      );
    }
    header.append(headText,actions);el.appendChild(header);
    const body=document.createElement("div");body.className="dd-visual";
    el.appendChild(body);
    if(ghost) {
      const text=document.createElement("p");text.className="dd-ghost-note";
      text.textContent="العنصر مخفي؛ اضغط زر العين لإظهاره";
      body.appendChild(text);
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
        body.style.cursor="pointer";body.addEventListener("click",()=>details(chart.title,data.items));
      } else if(chart.type==="table") {
        const wrap=document.createElement("div");wrap.className="dd-table-wrap";
        const table=document.createElement("table");table.className="dd-table";
        const tr=document.createElement("tr");
        [fieldMeta(chart.dimension)?.name||"القيمة","عدد الوثائق"].forEach(t=>{
          const th=document.createElement("th");th.textContent=t;tr.appendChild(th);});
        const thead=document.createElement("thead");thead.appendChild(tr);table.appendChild(thead);
        const tbody=document.createElement("tbody");
        for(const group of data.groups) {
          const row=document.createElement("tr");row.style.cursor="pointer";
          for(const value of [group.label,group.value.toLocaleString("ar-SA")]) {
            const td=document.createElement("td");td.textContent=value;row.appendChild(td);
          }
          row.addEventListener("click",()=>details(group.label,group.docs));tbody.appendChild(row);
        }
        table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
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
            btn.addEventListener("click",()=>details(group.label,group.docs));
            legend.appendChild(btn);
          }
          body.appendChild(legend);
        }
        const config={
          type,
          data:{labels:data.groups.map(g=>g.label),datasets:[{
            label:"عدد الوثائق",data:data.groups.map(g=>g.value),
            borderColor:"#2367c6",backgroundColor:circ?data.groups.map((_,i)=>palette[i%palette.length]):"#2367c6",
            fill:false,borderWidth:type==="line"?2:0,tension:.27,borderRadius:type==="bar"?4:0
          }]},
          options:{
            responsive:true,maintainAspectRatio:false,indexAxis:axis?"y":"x",
            plugins:{legend:{display:false},tooltip:{backgroundColor:"#0b1c49"}},
            scales:circ?{}:{
              x:{grid:{display:axis,color:"#eef1f6"},ticks:{color:"#657469",maxRotation:30,autoSkip:true}},
              y:{beginAtZero:true,grid:{color:axis?"transparent":"#eef1f6"},ticks:{color:"#657469"}}
            },
            onClick:(_,points)=>{const group=data.groups[points[0]?.index];if(group)details(group.label,group.docs);}
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
      if(!editMode)return;
      event.preventDefault();const source=event.dataTransfer?.getData("text/plain");
      if(!source||source===chart.id)return;
      const i=charts.findIndex(c=>c.id===source),j=charts.findIndex(c=>c.id===chart.id);
      if(i<0||j<0)return;
      charts.splice(j,0,charts.splice(i,1)[0]);persist();render();
    });
    return el;
  }
  function render() {
    instances.forEach(c=>c.destroy());instances=[];
    root.classList.toggle("dd-edit-mode",editMode);
    $("dd-customize").textContent=editMode?"✓ إنهاء التخصيص":"⚙ تخصيص اللوحة";
    $("dd-customize").setAttribute("aria-pressed",String(editMode));
    $("dd-add").classList.toggle("dd-hidden",!editMode);
    $("dd-workspace-help").textContent=editMode
      ?"حدد الشارت لتعديل قيمه أو اسحبه لتغيير ترتيبه"
      :"اضغط «تخصيص اللوحة» لتعديل الشارتات";
    $("dd-grid").replaceChildren(...charts.filter(c=>editMode||!c.hidden).map(drawCard));
    $("dd-empty").classList.toggle("dd-hidden",charts.some(c=>!c.hidden)||editMode&&charts.length>0);
  }
  function selectedValidChoices() {
    return observedValues(editing.dimension);
  }
  function valueChoices() {
    const target=$("dd-value-list");target.replaceChildren();
    if(!editing)return;
    const term=$("dd-value-search").value.trim().toLocaleLowerCase();
    const categories=selectedValidChoices();
    const visible=categories.filter(x=>x.label.toLocaleLowerCase().includes(term));
    const selected=new Set(editing.selectedValues);
    if(!visible.length) {
      const p=document.createElement("p");p.className="dd-values-help";
      p.textContent=partial
        ?"لا توجد قيم ضمن الوثائق التي أمكن قراءتها؛ قد تكون البيانات غير مكتملة."
        :"لا توجد قيم مطابقة للبحث في الوثائق المتاحة.";
      target.appendChild(p);
    }
    for(const category of visible) {
      const label=document.createElement("label");label.className="dd-value-option";
      const check=document.createElement("input");check.type="checkbox";
      check.checked=selected.has(category.value);check.value=category.value;
      check.addEventListener("change",()=>{
        const set=new Set(editing.selectedValues);
        if(check.checked)set.add(category.value);else set.delete(category.value);
        editing.selectedValues=[...set];valueChoices();
      });
      const text=document.createElement("span");text.textContent=category.label;
      const count=document.createElement("small");
      count.textContent=category.count.toLocaleString("ar-SA")+" وثيقة";
      label.append(check,text,count);target.appendChild(label);
    }
    const available=new Set(categories.map(c=>c.value));
    const unavailable=editing.selectedValues.filter(x=>!available.has(x));
    const hint=$("dd-value-summary");
    hint.textContent=unavailable.length
      ?"بعض القيم المحفوظة لم تعد متاحة لهذا المستخدم؛ لن يتم عرض مستندات لا يحق له قراءتها."
      :editing.selectedValues.length
        ?"تم اختيار "+editing.selectedValues.length+" من القيم. سيُعرض العدد الفريد للوثائق المطابقة فقط."
        :"لم تُحدد قيم: سيعرض الشارت جميع القيم الموجودة في الوثائق المقروءة.";
    if(partial)hint.textContent+=" تنبيه: القائمة مبنية على نتائج جزئية وليست فهرس المستودع كاملًا.";
  }
  function openEditor(id) {
    if(!editMode)return;
    const item=charts.find(c=>c.id===id);
    editing=item?structuredClone(item):{
      id:"custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),
      title:"شارت جديد",type:"bar",dimension:"__template",height:340,
      wide:false,hidden:false,selectedValues:[]
    };
    $("dd-title").value=editing.title;$("dd-type").value=editing.type;
    $("dd-height").value=editing.height;$("dd-heightlabel").textContent=editing.height+"px";
    selectOptions($("dd-dimension"),[...BUILTIN,...fields].map(f=>({
      value:String(f.id),label:f.name+(f.multi?" (قيم متعددة)":"")
    })),editing.dimension,null);
    $("dd-value-search").value="";
    valueChoices();
    $("dd-editoroverlay").classList.remove("dd-hidden");
  }
  const closeEditor=()=>{$("dd-editoroverlay").classList.add("dd-hidden");editing=null;};
  function saveEditor() {
    if(!editing)return;
    editing.title=$("dd-title").value.trim()||"شارت بدون عنوان";
    editing.type=$("dd-type").value;
    editing.dimension=$("dd-dimension").value;
    editing.height=Math.max(280,Number($("dd-height").value)||340);
    // Only store chosen category identifiers; aggregation always counts unique documents.
    const entry=normalChart(editing);
    const index=charts.findIndex(c=>c.id===entry.id);
    if(index>=0)charts[index]=entry;else charts.push(entry);
    persist();closeEditor();render();
  }
  async function refresh() {
    if(busy)return;busy=true;
    $("dd-refresh").disabled=true;$("dd-refresh").textContent="⏳ تحميل بيانات Laserfiche...";
    $("dd-warning").classList.add("dd-hidden");
    try {
      const [catalog,records]=await Promise.all([
        fetch("/DynamicDashboard/Fields",{credentials:"same-origin",cache:"no-store"}),
        fetch("/DynamicDashboard/Rows",{credentials:"same-origin",cache:"no-store"})
      ]);
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
      controlsFromData();render();
    } catch(error) {
      $("dd-warning").textContent=String(error.message||error);
      $("dd-warning").classList.remove("dd-hidden");
      rows=[];fields=[];controlsFromData();render();
    } finally{
      busy=false;$("dd-refresh").disabled=false;$("dd-refresh").textContent="⟳ تحديث البيانات";
    }
  }
  function wire() {
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
    $("dd-close-details").addEventListener("click",()=>{
      $("dd-details-overlay").classList.add("dd-hidden");
    });
    $("dd-details-overlay").addEventListener("click",event=>{
      if(event.target===$("dd-details-overlay"))event.target.classList.add("dd-hidden");
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"){closeEditor();$("dd-details-overlay").classList.add("dd-hidden");}
    });
    $("dd-dimension").addEventListener("change",event=>{
      editing.dimension=event.target.value;
      editing.selectedValues=[];
      valueChoices();
    });
    $("dd-value-search").addEventListener("input",valueChoices);
    $("dd-clear-values").addEventListener("click",()=>{
      if(editing){editing.selectedValues=[];valueChoices();}
    });
    $("dd-height").addEventListener("input",event=>{
      $("dd-heightlabel").textContent=event.target.value+"px";
    });
  }
  loadConfig(null);wire();
  restoreServerLayout().finally(refresh);
})();
