document.addEventListener("mousedown", function (event) {
    if (!event.target.closest("input, textarea, [contenteditable='true']")) {
        document.activeElement.blur();
    }
});