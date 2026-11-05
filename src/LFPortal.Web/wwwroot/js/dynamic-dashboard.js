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
    {id:"base-docs",title:"إجمالي الوثائق الظاهرة",type:"kpi",dimension:"__template",measure:"__count",agg:"count",wide:false,height:280,hidden:false,local:{field:""}},
    {id:"base-templates",title:"توزيع الوثائق حسب القالب",type:"doughnut",dimension:"__template",measure:"__count",agg:"count",wide:false,height:340,hidden:false,local:{field:""}},
    {id:"base-months",title:"الوثائق حسب تاريخ الإضافة",type:"line",dimension:"__created",measure:"__count",agg:"count",wide:true,height:340,hidden:false,local:{field:""}},
    {id:"base-users",title:"الوثائق حسب المستخدم",type:"bar",dimension:"__creator",measure:"__count",agg:"count",wide:false,height:320,hidden:false,local:{field:""}}
  ];
  let rows = [], fields = [], charts = [], instances = [], editing = null;
  let partial = false, busy = false;
  let globalField = {field:"",value:"",from:"",to:"",operator:"contains"};
  let globalYear = "", globalCreator = "", globalTemplate = "", range = "all", from = "", to = "";

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && Array.isArray(saved.charts)) {
        charts = saved.charts.filter(x => x && typeof x.id === "string" &&
          ["bar","horizontal","line","doughnut","pie","table","kpi"].includes(x.type))
          .slice(0,60).map(x => ({
            id:x.id,title:String(x.title||"شارت").slice(0,90),type:x.type,
            dimension:String(x.dimension||"__template"),measure:String(x.measure||"__count"),
            agg:["count","sum","avg","min","max"].includes(x.agg)?x.agg:"count",
            wide:Boolean(x.wide),height:Math.max(240,Math.min(520,Number(x.height)||320)),
            hidden:Boolean(x.hidden),local:x.local||{field:""}
          }));
        if (saved.globalField) globalField = saved.globalField;
        globalYear = saved.globalYear || "";
        globalCreator = saved.globalCreator || "";
        globalTemplate = saved.globalTemplate || "";
        range = saved.range || "all";
        from = saved.from || ""; to = saved.to || "";
        return;
      }
    } catch (_) { /* Local storage is optional; never block live analytics. */ }
    charts = defaults.map(c => ({...c,local:{field:""}}));
  }
  function persist() {
    try {
      localStorage.setItem(key,JSON.stringify({charts,globalField,globalYear,globalCreator,
        globalTemplate,range,from,to}));
    } catch (_) { /* Private browsing can disable storage. */ }
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
  function inputControl(type, placeholder, value) {
    const el = document.createElement("input");
    el.className = "dd-control"; el.type = type;
    el.placeholder = placeholder || ""; el.value = value || "";
    return el;
  }
  function selectControl(values, value, placeholder) {
    const el = document.createElement("select"); el.className = "dd-control";
    selectOptions(el,values,value,placeholder); return el;
  }
  function labelControl(text, ctrl) {
    const box = document.createElement("label");
    box.textContent = text; box.appendChild(ctrl); return box;
  }
  const fieldMeta = id => [...BUILTIN,...fields].find(f => String(f.id)===String(id));
  function kind(id) {
    const type = String(fieldMeta(id)?.type || "string").toLowerCase();
    if (type.includes("date") || type.includes("time")) return "date";
    if (/(integer|number|numeric|decimal|currency|float|double|long)/.test(type)) return "number";
    if (/(bool|checkbox)/.test(type)) return "boolean";
    if (/(list|select|dropdown|choice)/.test(type)) return "list";
    return "text";
  }
  function valuesFor(row,id) {
    const raw = String(id);
    if (raw==="__template") return row.template ? [row.template] : [];
    if (raw==="__creator") return row.creator ? [row.creator] : [];
    if (raw==="__created") return row.created ? [row.created] : [];
    if (raw==="__modified") return row.modified ? [row.modified] : [];
    if (raw==="__name") return row.name ? [row.name] : [];
    if (raw==="__folder") return row.folder ? [row.folder] : [];
    if (raw==="__pages") return row.pages===null||row.pages===undefined ? [] : [String(row.pages)];
    const value = row.fields && row.fields[raw];
    return Array.isArray(value) ? value.filter(v => v !== null && v !== undefined).map(String) : [];
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
  function allPossibleValues(id) {
    return unique(rows.flatMap(row=>valuesFor(row,id))).sort((a,b)=>a.localeCompare(b,"ar"));
  }
  function createFieldInputs(target,condition,changed) {
    target.replaceChildren();
    if (!condition?.field) return;
    const type = kind(condition.field);
    const update = (part,val) => { condition[part] = val; changed(); };
    if (type==="number" || type==="date") {
      for (const p of ["from","to"]) {
        const el = inputControl(type==="date"?"date":"number",p==="from"?"من":"إلى",condition[p]);
        el.addEventListener("input",()=>update(p,el.value));
        target.appendChild(labelControl(p==="from"?"من":"إلى",el));
      }
      return;
    }
    if (type==="list" || type==="boolean") {
      const vals = type==="boolean" ? ["true","false","1","0","نعم","لا"] : allPossibleValues(condition.field);
      const el = selectControl(vals.map(v=>({label:v,value:v})),condition.value||"","كل القيم");
      el.addEventListener("change",()=>update("value",el.value));
      target.appendChild(el); return;
    }
    const operator = selectControl(
      [{value:"contains",label:"يحتوي على"},{value:"equals",label:"يساوي"},{value:"starts",label:"يبدأ بـ"}],
      condition.operator||"contains",null);
    operator.addEventListener("change",()=>update("operator",operator.value));
    const el = inputControl("text","ابحث عن قيمة الحقل",condition.value);
    el.addEventListener("input",()=>update("value",el.value));
    target.append(operator,el);
  }
  function matchesField(row,filter) {
    if (!filter?.field) return true;
    const vs = valuesFor(row,filter.field);
    const t = kind(filter.field);
    if (t==="date" || t==="number") {
      if (!filter.from && !filter.to) return true;
      return vs.some(v=>{
        const x = t==="date" ? dateStamp(v)?.getTime() : number(v);
        if (x === null || x === undefined) return false;
        if (t==="date") {
          const lower = filter.from ? Date.parse(filter.from+"T00:00:00") : -Infinity;
          const upper = filter.to ? Date.parse(filter.to+"T23:59:59.999") : Infinity;
          return x>=lower && x<=upper;
        }
        return x>=(filter.from!==""&&filter.from!=null?number(filter.from):-Infinity) &&
          x<=(filter.to!==""&&filter.to!=null?number(filter.to):Infinity);
      });
    }
    const value = String(filter.value||"").trim().toLocaleLowerCase();
    if (!value) return true;
    return vs.some(v=>{
      const candidate=String(v).toLocaleLowerCase();
      if (t==="list"||t==="boolean"||filter.operator==="equals") return candidate===value;
      if (filter.operator==="starts") return candidate.startsWith(value);
      return candidate.includes(value);
    });
  }
  function inRange(row) {
    const dt = dateStamp(row.created);
    if (!dt) return range==="all" && !globalYear;
    if (globalYear && String(dt.getFullYear())!==globalYear) return false;
    const now = new Date();
    if (range==="all") return true;
    if (range==="today") return dayKey(dt)===dayKey(now);
    if (range==="week") {
      const start = new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7));
      return dt>=start && dt<=now;
    }
    if (range==="month") return dt.getFullYear()===now.getFullYear()&&dt.getMonth()===now.getMonth();
    if (range==="year") return dt.getFullYear()===now.getFullYear();
    if (range==="custom") {
      return (!from || dt>=new Date(from+"T00:00:00")) &&
        (!to || dt<=new Date(to+"T23:59:59.999"));
    }
    return true;
  }
  function filtered(chart) {
    return rows.filter(row=>inRange(row) &&
      (!globalCreator || row.creator===globalCreator) &&
      (!globalTemplate || row.template===globalTemplate) &&
      matchesField(row,globalField) && (!chart || matchesField(row,chart.local)));
  }
  function controlsFromData() {
    const years=unique(rows.map(r=>dateStamp(r.created)?.getFullYear())).sort((a,b)=>b-a);
    selectOptions($("dd-year"),years.map(v=>({label:v,value:v})),globalYear,"كل السنوات");
    selectOptions($("dd-creator"),unique(rows.map(r=>r.creator)).sort().map(v=>({label:v,value:v})),globalCreator,"كل المستخدمين");
    selectOptions($("dd-template"),unique(rows.map(r=>r.template)).sort().map(v=>({label:v,value:v})),globalTemplate,"كل القوالب");
    const all=[...BUILTIN,...fields].map(f=>({label:f.name+(f.multi?" (متعدد)":""),
      value:String(f.id)}));
    selectOptions($("dd-fieldfilter"),all,globalField.field||"","بدون فلتر حقول");
    $("dd-range").value=range;
    $("dd-datefrom").value=from; $("dd-dateto").value=to;
    $("dd-dates").classList.toggle("dd-hidden",range!=="custom");
    createFieldInputs($("dd-fieldinputs"),globalField,()=>{persist();render();});
  }
  function groupKey(id,value) {
    if (kind(id)!=="date") return String(value);
    const dt=dateStamp(value);
    return dt ? dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0") : "غير محدد";
  }
  function summary(chart,source) {
    if (chart.type==="kpi") {
      const nums = chart.measure==="__count" ? [] : source.flatMap(r=>valuesFor(r,chart.measure)).map(number).filter(v=>v!==null);
      const agg=chart.agg;
      let val=source.length;
      if (chart.measure!=="__count") {
        val=nums.length===0?null:agg==="sum"?nums.reduce((a,b)=>a+b,0):
          agg==="avg"?nums.reduce((a,b)=>a+b,0)/nums.length:
          agg==="min"?Math.min(...nums):agg==="max"?Math.max(...nums):nums.length;
      }
      return {kpi:val,items:source};
    }
    const groups = new Map();
    for (const row of source) {
      const xs=unique(valuesFor(row,chart.dimension).map(v=>groupKey(chart.dimension,v)));
      if (!xs.length) xs.push("غير محدد");
      const ns=chart.measure==="__count" ? [1] :
        valuesFor(row,chart.measure).map(number).filter(n=>n!==null);
      for (const x of xs) {
        if (!groups.has(x)) groups.set(x,{label:x,docs:[],values:[]});
        const g=groups.get(x);g.docs.push(row);g.values.push(...ns);
      }
    }
    let list=[...groups.values()].map(g=>{
      const n=g.values.length;
      let value;
      if (chart.measure==="__count") value=g.docs.length;
      else if (chart.agg==="sum") value=g.values.reduce((a,b)=>a+b,0);
      else if (chart.agg==="avg") value=n?g.values.reduce((a,b)=>a+b,0)/n:0;
      else if (chart.agg==="min") value=n?Math.min(...g.values):0;
      else if (chart.agg==="max") value=n?Math.max(...g.values):0;
      else value=n;
      return {...g,value};
    });
    if (kind(chart.dimension)==="date") list.sort((a,b)=>a.label.localeCompare(b.label));
    else list.sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,"ar"));
    return {groups:list.slice(0,30),extra:Math.max(0,list.length-30)};
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
  function drawCard(chart) {
    const el=document.createElement("article");
    el.className="dd-card"+(chart.wide?" wide":"");
    el.style.height=chart.height+"px";el.dataset.id=chart.id;el.draggable=true;
    const header=document.createElement("header");header.className="dd-card-head";
    const headText=document.createElement("div"),title=document.createElement("strong");
    title.textContent=chart.title;headText.appendChild(title);
    const sub=document.createElement("small");sub.className="dd-card-sub";
    sub.textContent=(fieldMeta(chart.dimension)?.name||"الوثائق")+" · "+(chart.measure==="__count"?"العدد":(fieldMeta(chart.measure)?.name||"القيمة"));
    headText.appendChild(sub);
    const actions=document.createElement("div");actions.className="dd-card-actions";
    actions.append(
      iconButton("تعديل الشارت","⚙",()=>openEditor(chart.id)),
      iconButton(chart.wide?"تصغير العرض":"توسيع العرض","⤢",()=>{chart.wide=!chart.wide;persist();render();}),
      iconButton("إخفاء الشارت","◉",()=>{chart.hidden=true;persist();render();}),
      iconButton("حذف الشارت","×",()=>{if(window.confirm("حذف هذا الشارت من لوحتك؟")){charts=charts.filter(c=>c.id!==chart.id);persist();render();}}),
      iconButton("اسحب لتغيير الترتيب","⠿",()=>{}));
    header.append(headText,actions);el.appendChild(header);
    const body=document.createElement("div");body.className="dd-visual";body.style.height="calc(100% - 57px)";
    el.appendChild(body);
    const data=summary(chart,filtered(chart));
    if(chart.type==="kpi") {
      const k=document.createElement("div");k.className="dd-kpi";
      k.textContent=data.kpi===null?"—":Number(data.kpi).toLocaleString("ar-SA",{maximumFractionDigits:2});
      const small=document.createElement("small");small.textContent=chart.measure==="__count"?"وثيقة":"القيمة المحسوبة";
      k.appendChild(small);body.appendChild(k);
      body.style.cursor="pointer";body.addEventListener("click",()=>details(chart.title,data.items));
    } else if(chart.type==="table") {
      const scroll=document.createElement("div");scroll.className="dd-table-wrap";
      const table=document.createElement("table");table.className="dd-table";
      const th=document.createElement("tr");
      [fieldMeta(chart.dimension)?.name||"التصنيف","القيمة"].forEach(t=>{
        const cell=document.createElement("th");cell.textContent=t;th.appendChild(cell);});
      const thead=document.createElement("thead");thead.appendChild(th);table.appendChild(thead);
      const tbody=document.createElement("tbody");
      for(const g of data.groups) {
        const tr=document.createElement("tr");tr.style.cursor="pointer";
        const c1=document.createElement("td");c1.textContent=g.label;
        const c2=document.createElement("td");c2.textContent=g.value.toLocaleString("ar-SA",{maximumFractionDigits:2});
        tr.append(c1,c2);tr.addEventListener("click",()=>details(g.label,g.docs));tbody.appendChild(tr);
      }
      table.appendChild(tbody);scroll.appendChild(table);body.appendChild(scroll);
    } else if(!window.Chart) {
      const error=document.createElement("p");error.textContent="مكتبة الرسم المحلي غير متاحة";body.appendChild(error);
    } else {
      const canvas=document.createElement("canvas");body.appendChild(canvas);
      const type=chart.type==="horizontal"?"bar":chart.type;
      const axis=chart.type==="horizontal";
      const circ=["doughnut","pie"].includes(type);
      const config={
        type,
        data:{
          labels:data.groups.map(g=>g.label),
          datasets:[{label:chart.title,data:data.groups.map(g=>g.value),
            borderColor:"#2367c6",backgroundColor:circ?data.groups.map((_,i)=>palette[i%palette.length]):"#2367c6",
            fill:false,borderWidth:type==="line"?2:0,tension:.27,borderRadius:type==="bar"?4:0}]
        },
        options:{
          responsive:true,maintainAspectRatio:false,
          indexAxis:axis?"y":"x",
          plugins:{legend:{display:circ,position:"bottom",labels:{boxWidth:10,font:{size:10}}},
            tooltip:{backgroundColor:"#0b1c49"}},
          scales:circ?{}:{
            x:{grid:{display:axis,color:"#eef1f6"},ticks:{color:"#657469",maxRotation:30,autoSkip:true}},
            y:{beginAtZero:true,grid:{color:axis?"transparent":"#eef1f6"},ticks:{color:"#657469"}}
          },
          onClick:(_,points)=>{if(points.length){const g=data.groups[points[0].index];if(g)details(g.label,g.docs);}}
        }
      };
      instances.push(new Chart(canvas,config));
    }
    el.addEventListener("dragstart",event=>{
      if(event.target.closest("button,select,input")){event.preventDefault();return;}
      event.dataTransfer.setData("text/plain",chart.id);event.dataTransfer.effectAllowed="move";
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend",()=>el.classList.remove("is-dragging"));
    el.addEventListener("dragover",event=>event.preventDefault());
    el.addEventListener("drop",event=>{
      event.preventDefault();const source=event.dataTransfer.getData("text/plain");
      if(!source||source===chart.id)return;
      const i=charts.findIndex(c=>c.id===source),j=charts.findIndex(c=>c.id===chart.id);
      if(i<0||j<0)return;
      charts.splice(j,0,charts.splice(i,1)[0]);persist();render();
    });
    return el;
  }
  function render() {
    instances.forEach(c=>c.destroy());instances=[];
    const selected=filtered(null);
    $("dd-resultcount").textContent=selected.length.toLocaleString("ar-SA")+" مستند";
    $("dd-grid").replaceChildren(...charts.filter(c=>!c.hidden).map(drawCard));
    $("dd-empty").classList.toggle("dd-hidden",charts.some(c=>!c.hidden));
    const hidden=charts.filter(c=>c.hidden).map(c=>({value:c.id,label:c.title}));
    selectOptions($("dd-hiddenitems"),hidden,"",hidden.length?"اختر شارتًا لإظهاره":"لا توجد شارتات مخفية");
  }
  function editorOptions() {
    const all=[...BUILTIN,...fields].map(f=>({value:String(f.id),label:f.name+(f.multi?" (قيم متعددة)":"")}));
    const numeric=[{value:"__pages",label:"عدد الصفحات"},
      ...fields.filter(f=>kind(f.id)==="number").map(f=>({value:String(f.id),label:f.name}))];
    selectOptions($("dd-dimension"),all,editing.dimension,null);
    selectOptions($("dd-measure"),[{value:"__count",label:"عدد الوثائق / القيم"},...numeric],editing.measure,null);
    selectOptions($("dd-localfield"),all,editing.local.field||"","بدون فلتر خاص");
    createFieldInputs($("dd-localinputs"),editing.local,()=>{});
    $("dd-agg").disabled=editing.measure==="__count";
  }
  function openEditor(id) {
    const item=charts.find(c=>c.id===id);
    editing=item?structuredClone(item):{
      id:"custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),
      title:"شارت جديد",type:"bar",dimension:"__template",measure:"__count",
      agg:"count",wide:false,height:320,hidden:false,local:{field:""}
    };
    $("dd-title").value=editing.title;$("dd-type").value=editing.type;
    $("dd-height").value=editing.height;$("dd-heightlabel").textContent=editing.height+"px";
    editorOptions();
    $("dd-editoroverlay").classList.remove("dd-hidden");
  }
  const closeEditor=()=>{$("dd-editoroverlay").classList.add("dd-hidden");editing=null;};
  function saveEditor() {
    if(!editing)return;
    editing.title=$("dd-title").value.trim()||"شارت بدون عنوان";
    editing.type=$("dd-type").value;
    editing.dimension=$("dd-dimension").value;
    editing.measure=$("dd-measure").value;
    editing.agg=editing.measure==="__count"?"count":$("dd-agg").value;
    editing.height=Number($("dd-height").value);
    const index=charts.findIndex(c=>c.id===editing.id);
    if(index>=0)charts[index]=editing;else charts.push(editing);
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
    $("dd-add").addEventListener("click",()=>openEditor(null));
    $("dd-closeeditor").addEventListener("click",closeEditor);
    $("dd-cancel").addEventListener("click",closeEditor);
    $("dd-save").addEventListener("click",saveEditor);
    $("dd-editoroverlay").addEventListener("click",e=>{if(e.target===$("dd-editoroverlay"))closeEditor();});
    $("dd-close-details").addEventListener("click",()=>{$("dd-details-overlay").classList.add("dd-hidden");});
    $("dd-details-overlay").addEventListener("click",e=>{if(e.target===$("dd-details-overlay"))e.target.classList.add("dd-hidden");});
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeEditor();$("dd-details-overlay").classList.add("dd-hidden");}});
    $("dd-dimension").addEventListener("change",()=>{editing.dimension=$("dd-dimension").value;});
    $("dd-measure").addEventListener("change",()=>{
      editing.measure=$("dd-measure").value;
      $("dd-agg").disabled=editing.measure==="__count";
      if(editing.measure==="__count")$("dd-agg").value="count";
    });
    $("dd-localfield").addEventListener("change",()=>{
      editing.local={field:$("dd-localfield").value,value:"",from:"",to:"",operator:"contains"};
      createFieldInputs($("dd-localinputs"),editing.local,()=>{});
    });
    $("dd-height").addEventListener("input",e=>$("dd-heightlabel").textContent=e.target.value+"px");
    $("dd-year").addEventListener("change",e=>{globalYear=e.target.value;persist();render();});
    $("dd-creator").addEventListener("change",e=>{globalCreator=e.target.value;persist();render();});
    $("dd-template").addEventListener("change",e=>{globalTemplate=e.target.value;persist();render();});
    $("dd-range").addEventListener("change",e=>{
      range=e.target.value;$("dd-dates").classList.toggle("dd-hidden",range!=="custom");
      persist();render();
    });
    $("dd-datefrom").addEventListener("change",e=>{from=e.target.value;persist();render();});
    $("dd-dateto").addEventListener("change",e=>{to=e.target.value;persist();render();});
    $("dd-fieldfilter").addEventListener("change",e=>{
      globalField={field:e.target.value,value:"",from:"",to:"",operator:"contains"};
      createFieldInputs($("dd-fieldinputs"),globalField,()=>{persist();render();});
      persist();render();
    });
    $("dd-clear").addEventListener("click",()=>{
      globalYear="";globalCreator="";globalTemplate="";range="all";from="";to="";
      globalField={field:"",value:"",from:"",to:"",operator:"contains"};
      persist();controlsFromData();render();
    });
    $("dd-restore").addEventListener("click",()=>{
      const id=$("dd-hiddenitems").value;
      const target=charts.find(c=>c.id===id);if(!target)return;
      target.hidden=false;persist();render();
    });
  }
  loadConfig();wire();refresh();
})();
