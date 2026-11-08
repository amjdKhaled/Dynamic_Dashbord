/* Installed by Dynamic Dashboard setup. */
(function () {
    "use strict";
    var DASHBOARD_BASE_URL = 'http://127.0.0.1:5190';
    const doc = window.document;
    function addButton() {
        const navbar = doc.getElementById("rightNavbar");
        if (!navbar || doc.getElementById("lf-dynamic-dashboard-btn")) return;
        const link = doc.createElement("a");
        link.id = "lf-dynamic-dashboard-btn";
        link.className = "btn browseNavButton";
        link.href = DASHBOARD_BASE_URL + "/DynamicDashboard";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:6px 10px;color:#fff;text-decoration:none;white-space:nowrap";
        link.innerHTML = '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 2h5v5H2zm9 0h5v5h-5zM2 11h5v5H2zm9 0h5v5h-5z"/></svg> Dynamic Dashboard';
        const menu = doc.createElement("ul");
        menu.className = "nav navbar-nav";
        const item = doc.createElement("li");
        item.appendChild(link);
        menu.appendChild(item);
        const existing = navbar.querySelector("#lf-dashboard-btn")?.closest("ul");
        navbar.insertBefore(menu, existing?.parentNode === navbar ? existing : navbar.firstChild);
    }
    function start() {
        new MutationObserver(addButton).observe(doc.body, {childList:true, subtree:true});
        addButton();
    }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, {once:true});
    else start();
})();
