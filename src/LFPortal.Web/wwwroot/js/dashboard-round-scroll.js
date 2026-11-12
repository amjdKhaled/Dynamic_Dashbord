/* Keep the two scroll controls shared by the overview and custom chart legends. */
window.dashboardRoundScroll = function (results, arabic) {
    const wrapper = document.createElement("div");
    wrapper.className = "dashboard-round-scroll";
    function arrow(direction, symbol, title) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dashboard-round-arrow";
        button.textContent = symbol;
        button.title = title;
        button.setAttribute("aria-label", title);
        button.addEventListener("click", () => {
            const rowHeight = results.querySelector(".dashboard-round-row")?.getBoundingClientRect().height || 24;
            results.scrollBy({top: direction * rowHeight * 3, behavior: "smooth"});
        });
        return button;
    }
    if (results.parentNode) results.before(wrapper);
    const up = arrow(-1, "▲", arabic ? "تمرير النتائج لأعلى" : "Scroll results up");
    const down = arrow(1, "▼", arabic ? "تمرير النتائج لأسفل" : "Scroll results down");
    wrapper.append(up, results, down);
    function updateArrows() {
        const heightWithoutArrows = wrapper.clientHeight;
        const overflows = results.scrollHeight > heightWithoutArrows + 1;
        wrapper.classList.toggle("has-overflow", overflows);
        up.disabled = results.scrollTop <= 1;
        down.disabled = results.scrollTop + results.clientHeight >= results.scrollHeight - 1;
    }
    results.addEventListener("scroll", updateArrows, {passive:true});
    const observer = new ResizeObserver(() => {
        if (!wrapper.isConnected) {
            observer.disconnect();
            return;
        }
        updateArrows();
    });
    observer.observe(wrapper);
    observer.observe(results);
    requestAnimationFrame(updateArrows);
    return wrapper;
};
