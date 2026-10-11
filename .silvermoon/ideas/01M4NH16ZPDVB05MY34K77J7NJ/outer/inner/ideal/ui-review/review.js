function reportHeight() {
  window.parent.postMessage({
    type: "ui-review:height",
    height: Math.ceil(document.body.getBoundingClientRect().height),
  }, "*");
}
new ResizeObserver(reportHeight).observe(document.body);
window.addEventListener("load", reportHeight);
window.addEventListener("resize", reportHeight);
["click", "change", "input", "toggle"].forEach((type) => {
  document.addEventListener(type, reportHeight, true);
});
const menus = [...document.querySelectorAll(".view-menu")];
document.addEventListener("click", (event) => {
  menus.forEach((menu) => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const menu = menus.find((candidate) => candidate.open);
  if (!menu) return;
  event.preventDefault();
  menu.open = false;
  menu.querySelector("summary").focus();
});
menus.forEach((menu) => {
  menu.addEventListener("change", () => {
    menu.open = false;
    menu.querySelector("summary").focus();
  });
});
