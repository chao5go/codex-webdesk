async function load() {
  const container = document.getElementById("info");
  try {
    const response = await fetch("/api/plugins/server-info/info");
    if (response.status === 401) {
      parent.postMessage({ type: "crw:session-expired" }, location.origin);
      throw new Error("登录已过期");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    container.replaceChildren();
    for (const [label, value] of [
      ["主机", data.hostname],
      ["系统", data.platform],
      ["运行时间", `${Math.floor(data.uptime / 3600)} 小时`],
      [
        "可用内存",
        `${(data.freeMemory / 1024 ** 3).toFixed(2)} / ${(data.totalMemory / 1024 ** 3).toFixed(2)} GB`,
      ],
    ]) {
      const card = document.createElement("div"),
        heading = document.createElement("small"),
        text = document.createElement("strong");
      heading.textContent = label;
      text.textContent = value;
      card.append(heading, text);
      container.append(card);
    }
  } catch (error) {
    container.textContent = error.message;
  }
}
document.getElementById("refresh").addEventListener("click", load);
load();
