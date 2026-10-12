function reportHeight() {
  window.parent.postMessage({ type: "ui-review:height", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
}
new ResizeObserver(reportHeight).observe(document.body);
window.addEventListener("load", reportHeight);
