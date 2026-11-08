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
            const rowHeight = results.firstElementChild?.getBoundingClientRect().height || 24;
            results.scrollBy({top: direction * rowHeight * 3, behavior: "smooth"});
        });
        return button;
    }
    if (results.parentNode) results.before(wrapper);
    wrapper.append(
        arrow(-1, "▲", arabic ? "تمرير النتائج لأعلى" : "Scroll results up"),
        results,
        arrow(1, "▼", arabic ? "تمرير النتائج لأسفل" : "Scroll results down")
    );
    return wrapper;
};
