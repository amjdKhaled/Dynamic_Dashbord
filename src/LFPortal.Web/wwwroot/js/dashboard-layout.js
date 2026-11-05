/* Dashboard-only behavior; never changes Laserfiche documents or shared layout. */
(function () {
"use strict";
document.addEventListener("DOMContentLoaded", function () {
    const page = document.getElementById("dashboard-page");
    if (!page || page.dataset.readonly === "true") return;
    const editButton = document.getElementById("dash-toggle-customize");
    const addButton = document.getElementById("dash-add-comparison");
    const editor = document.getElementById("dash-compare-editor");
    const host = document.getElementById("dash-widget-host");
    if (!editButton || !addButton || !editor || !host) return;

    // This is layout/preferences only, not document content or credentials.
    // Separate the preferences by repository AND authenticated account/browser.
    const identity = [page.dataset.repository || "", page.dataset.user || "", page.dataset.authMode || ""].join(":");
    const storageKey = "lf-dashboard-layout-v1:" + identity;
    let state = { order: [], cards: {}, comparisons: [] };
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (saved && typeof saved === "object") {
            state.order = Array.isArray(saved.order) ? saved.order.filter(x => typeof x === "string") : [];
            state.cards = saved.cards && typeof saved.cards === "object" ? saved.cards : {};
            state.comparisons = Array.isArray(saved.comparisons) ? saved.comparisons.filter(x => x && typeof x.id === "string") : [];
        }
    } catch (_) { /* Storage is optional; the dashboard still works. */ }

    let editing = false;
    let dragging = null;
    let fieldDefinitions = null;
    const widgets = new Map();
    const fieldOne = document.getElementById("dash-field-a");
    const fieldTwo = document.getElementById("dash-field-b");
    const valueOne = document.getElementById("dash-value-a");
    const valueTwo = document.getElementById("dash-value-b");
    const editorStatus = document.getElementById("dash-compare-status");
    const editorSubmit = document.getElementById("dash-compare-submit");
    const antiForgery = editor.querySelector('input[name="__RequestVerificationToken"]');

    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function save() {
        state.order = Array.from(host.children).map(element => element.dataset.widgetId);
        for (const [id, wrapper] of widgets) {
            state.cards[id] = {
                hidden: wrapper.dataset.hidden === "true",
                span: Number(wrapper.dataset.span) || 6,
                height: Number(wrapper.dataset.height) || 0
            };
        }
        try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {}
    }
    function resizeCharts(wrapper) {
        if (!window.Chart) return;
        wrapper.querySelectorAll("canvas").forEach(canvas => {
            const chart = Chart.getChart(canvas);
            if (chart) window.requestAnimationFrame(() => chart.resize());
        });
    }
    function applyVisibility(wrapper) {
        const hidden = wrapper.dataset.hidden === "true";
        wrapper.classList.toggle("dash-ghost", hidden);
        wrapper.style.display = hidden && !editing ? "none" : "";
        const eye = wrapper.querySelector(".dash-eye");
        if (eye) {
            eye.textContent = hidden ? "◉" : "◌";
            eye.title = hidden ? "إظهار العنصر" : "إخفاء العنصر";
            eye.setAttribute("aria-label", eye.title);
            eye.setAttribute("aria-pressed", String(hidden));
        }
        if (!hidden) resizeCharts(wrapper);
    }
    function updateMode() {
        page.classList.toggle("dash-editing", editing);
        editButton.textContent = editing ? "إنهاء التخصيص" : "تخصيص اللوحة";
        for (const wrapper of widgets.values()) applyVisibility(wrapper);
    }
    function setSpan(wrapper, span) {
        const next = clamp(Math.round(Number(span) || 6), 3, 12);
        wrapper.dataset.span = String(next);
        wrapper.style.gridColumn = "span " + next;
        resizeCharts(wrapper);
    }
    function setHeight(wrapper, height) {
        const next = Number(height) > 0 ? clamp(Math.round(Number(height)), 160, 950) : 0;
        wrapper.dataset.height = String(next);
        const body = wrapper.querySelector(".dash-widget-body");
        if (body) body.style.minHeight = next ? next + "px" : "";
        resizeCharts(wrapper);
    }
    function makeButton(text, label, className) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dash-tool " + (className || "");
        button.textContent = text;
        button.title = label;
        button.setAttribute("aria-label", label);
        return button;
    }
    function register(card, id, defaultSpan) {
        const wrapper = document.createElement("section");
        wrapper.className = "dash-widget";
        wrapper.dataset.widgetId = id;
        const controls = document.createElement("div");
        controls.className = "dash-widget-tools";
        const eye = makeButton("◌", "إخفاء العنصر", "dash-eye");
        eye.addEventListener("click", function (e) {
            e.preventDefault();
            wrapper.dataset.hidden = String(wrapper.dataset.hidden !== "true");
            applyVisibility(wrapper); save();
        });
        const grip = makeButton("⠿", "اسحب لتغيير موقع العنصر", "dash-drag-handle");
        grip.draggable = true;
        grip.addEventListener("dragstart", e => {
            if (!editing) { e.preventDefault(); return; }
            dragging = wrapper;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
            }
        });
        grip.addEventListener("dragend", () => {
            dragging = null;
            host.querySelectorAll(".dash-drag-over").forEach(el => el.classList.remove("dash-drag-over"));
        });
        controls.append(eye, grip);
        if (id.startsWith("comparison:")) {
            const remove = makeButton("×", "حذف شارت المقارنة", "dash-remove");
            remove.addEventListener("click", function () {
                if (!editing) return;
                const canvas = wrapper.querySelector("canvas");
                const chart = canvas && window.Chart && Chart.getChart(canvas);
                if (chart) chart.destroy();
                wrapper.remove();
                widgets.delete(id);
                state.comparisons = state.comparisons.filter(item => "comparison:" + item.id !== id);
                delete state.cards[id];
                save();
            });
            controls.appendChild(remove);
        }
        const body = document.createElement("div");
        body.className = "dash-widget-body";
        body.appendChild(card);
        const resize = document.createElement("button");
        resize.type = "button";
        resize.className = "dash-resize-handle";
        resize.title = "اسحب لتغيير عرض وارتفاع الكارد";
        resize.setAttribute("aria-label", resize.title);
        resize.textContent = "⤢";
        resize.addEventListener("pointerdown", function (e) {
            if (!editing || e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startSpan = Number(wrapper.dataset.span) || defaultSpan;
            const startHeight = wrapper.getBoundingClientRect().height;
            const unit = host.getBoundingClientRect().width / 12;
            resize.setPointerCapture(e.pointerId);
            const moved = evt => {
                const widthDelta = document.documentElement.dir === "rtl"
                    ? startX - evt.clientX : evt.clientX - startX;
                setSpan(wrapper, startSpan + Math.round(widthDelta / Math.max(unit, 1)));
                setHeight(wrapper, startHeight + evt.clientY - startY);
            };
            const done = () => {
                resize.removeEventListener("pointermove", moved);
                resize.removeEventListener("pointerup", done);
                resize.removeEventListener("pointercancel", done);
                save();
            };
            resize.addEventListener("pointermove", moved);
            resize.addEventListener("pointerup", done);
            resize.addEventListener("pointercancel", done);
        });
        wrapper.append(controls, body, resize);
        const saved = state.cards[id] || {};
        wrapper.dataset.hidden = String(saved.hidden === true);
        setSpan(wrapper, Number(saved.span) || defaultSpan);
        setHeight(wrapper, saved.height || 0);
        host.appendChild(wrapper);
        widgets.set(id, wrapper);

        wrapper.addEventListener("dragover", function (e) {
            if (!editing || !dragging || dragging === wrapper) return;
            e.preventDefault();
            wrapper.classList.add("dash-drag-over");
        });
        wrapper.addEventListener("dragleave", function () { wrapper.classList.remove("dash-drag-over"); });
        wrapper.addEventListener("drop", function (e) {
            wrapper.classList.remove("dash-drag-over");
            if (!editing || !dragging || dragging === wrapper) return;
            e.preventDefault();
            const from = Array.from(host.children).indexOf(dragging);
            const to = Array.from(host.children).indexOf(wrapper);
            if (from < to) wrapper.after(dragging);
            else wrapper.before(dragging);
            dragging = null;
            save();
            for (const item of widgets.values()) resizeCharts(item);
        });
        applyVisibility(wrapper);
        return wrapper;
    }
    // Lift the existing repository-backed dashboard cards into one sortable grid.
    // Their contents and chart configurations remain untouched.
    const candidates = Array.from(page.children).filter(element =>
        element.classList.contains("d-grid-2") ||
        (element.classList.contains("d-card") && element !== editor));
    if (candidates.length) {
        page.insertBefore(host, candidates[0]);
        let index = 0;
        for (const row of candidates) {
            const isPair = row.classList.contains("d-grid-2");
            const cards = isPair ? Array.from(row.children).filter(el => el.classList.contains("d-card")) : [row];
            for (const card of cards) {
                const id = "existing:" + index++;
                register(card, id, isPair ? 6 : 12);
            }
            if (isPair) row.remove();
        }
    }
    function applyOrder() {
        const order = state.order;
        for (const id of order) {
            const item = widgets.get(id);
            if (item) host.appendChild(item);
        }
    }
    async function loadFields() {
        if (fieldDefinitions) return fieldDefinitions;
        const response = await fetch("/Dashboard/FieldCompare/Fields", { credentials: "same-origin" });
        if (!response.ok) throw new Error("تعذر جلب الحقول. تحقق من جلسة Laserfiche.");
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("استجابة الحقول غير صالحة.");
        fieldDefinitions = data;
        for (const select of [fieldOne, fieldTwo]) {
            select.replaceChildren();
            for (const field of data) {
                const option = document.createElement("option");
                option.value = String(field.id);
                option.textContent = field.name + (field.type ? " (" + field.type + ")" : "");
                select.appendChild(option);
            }
        }
        if (data.length > 1) fieldTwo.selectedIndex = 1;
        return data;
    }
    async function getCounts(fieldA, valueA, fieldB, valueB) {
        if (!antiForgery || !antiForgery.value) throw new Error("رمز حماية الطلب غير متوفر.");
        const response = await fetch("/Dashboard/FieldCompare/Count", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": antiForgery.value },
            body: JSON.stringify({ fieldAId: Number(fieldA), valueA, fieldBId: Number(fieldB), valueB })
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) throw new Error(json && json.error ? json.error : "تعذر تنفيذ المقارنة بهذه القيم.");
        return json;
    }
    async function fillComparisonCard(config) {
        const wrapper = widgets.get("comparison:" + config.id);
        if (!wrapper) return;
        const status = wrapper.querySelector(".dash-comparison-status");
        const canvas = wrapper.querySelector("canvas");
        if (!status || !canvas) return;
        status.textContent = "جارٍ جلب نتائج Laserfiche...";
        try {
            const result = await getCounts(config.fieldAId, config.valueA, config.fieldBId, config.valueB);
            if (!widgets.has("comparison:" + config.id)) return;
            status.textContent = "نتائج حقيقية حسب صلاحيات المستخدم • " +
                result.countA + " وثيقة مقابل " + result.countB + " وثيقة";
            if (window.Chart) {
                const oldChart = Chart.getChart(canvas);
                if (oldChart) oldChart.destroy();
                new Chart(canvas, {
                    type: "bar",
                    data: {
                        labels: [result.fieldA + " = " + result.valueA, result.fieldB + " = " + result.valueB],
                        datasets: [{ label: "عدد الوثائق", data: [result.countA, result.countB],
                            backgroundColor: ["#0B3954", "#C29A2E"] }]
                    },
                    options: { responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
                });
            } else status.textContent += " • مكتبة الرسومات غير متاحة.";
        } catch (error) {
            status.textContent = error.message || "تعذر جلب المقارنة.";
        }
    }
    function createComparison(config) {
        const card = document.createElement("div");
        card.className = "d-card";
        const title = document.createElement("div");
        title.className = "d-card-title";
        title.textContent = "مقارنة قيم حقول الفهرسة";
        const status = document.createElement("div");
        status.className = "dash-comparison-status dash-compare-status";
        const container = document.createElement("div");
        container.className = "dash-compare-canvas";
        const canvas = document.createElement("canvas");
        container.appendChild(canvas);
        card.append(title, status, container);
        register(card, "comparison:" + config.id, 6);
        fillComparisonCard(config);
    }
    function statusMessage(message) { editorStatus.textContent = message; }
    editButton.addEventListener("click", function () {
        editing = !editing;
        updateMode();
        if (!editing) editor.hidden = true;
    });
    addButton.addEventListener("click", async function () {
        editor.hidden = !editor.hidden;
        if (editor.hidden) return;
        statusMessage("جارٍ قراءة حقول المستودع...");
        try {
            const fields = await loadFields();
            statusMessage(fields.length ? "اختر الحقلين واكتب قيمة كل حقل." : "لا توجد حقول متاحة لهذا المستخدم.");
        } catch (error) { statusMessage(error.message || "تعذر قراءة الحقول."); }
    });
    editorSubmit.addEventListener("click", async function () {
        const a = fieldOne.value, b = fieldTwo.value, va = valueOne.value.trim(), vb = valueTwo.value.trim();
        if (!a || !b || !va || !vb) { statusMessage("اختر حقلين وأدخل قيمتي المقارنة."); return; }
        editorSubmit.disabled = true;
        const config = { id: String(Date.now()) + "-" + String(Math.random()).slice(2, 7),
            fieldAId: Number(a), valueA: va, fieldBId: Number(b), valueB: vb };
        statusMessage("جارٍ التحقق من النتائج...");
        try {
            // Validate and count before creating a chart; no misleading empty widget on API errors.
            await getCounts(a, va, b, vb);
            state.comparisons.push(config);
            createComparison(config);
            save();
            editor.hidden = true;
            statusMessage("");
        } catch (error) { statusMessage(error.message || "تعذر إنشاء الشارت."); }
        finally { editorSubmit.disabled = false; }
    });
    for (const config of state.comparisons) createComparison(config);
    applyOrder();
    updateMode();
});
})();
