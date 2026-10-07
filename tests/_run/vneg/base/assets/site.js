/* Menu, copy-to-clipboard, below-fold enter, count-up, hero carousel, desktop dock. No scroll listener. No third-party code. */
(function () {
  document.documentElement.classList.add("js");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var buttons = document.querySelectorAll("[data-menu-button]");
  var panel = document.querySelector("[data-menu-panel]");

  function setOpen(open) {
    if (!panel) return;
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    buttons.forEach(function (button) {
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  if (buttons.length && panel) {
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        setOpen(panel.hasAttribute("hidden"));
      });
    });
    panel.addEventListener("click", function (event) {
      var node = event.target;
      if (node && node.closest && node.closest("a")) setOpen(false);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    setOpen(false);
    document.querySelectorAll("details.wechat-pop[open]").forEach(function (el) {
      el.removeAttribute("open");
    });
  });

  document.addEventListener("click", function (event) {
    window.setTimeout(function () {
      document.querySelectorAll("details.wechat-pop[open]").forEach(function (el) {
        if (!el.contains(event.target)) el.removeAttribute("open");
      });
    }, 0);
  });

  document.querySelectorAll("[data-copy]").forEach(function (el) {
    el.addEventListener("click", function () {
      var text = el.getAttribute("data-copy") || "";
      var prev = el.textContent;
      var timer = 0;
      var show = function () {
        el.textContent = document.documentElement.getAttribute("data-copied") || "OK";
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { el.textContent = prev; }, 1600);
      };
      var hide = function () {
        window.clearTimeout(timer);
        el.textContent = prev;
      };
      var legacy = function () {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-999px";
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
        document.body.removeChild(area);
        return !!ok;
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        show();
        var pending = navigator.clipboard.writeText(text);
        var failed = function () { if (!legacy()) hide(); };
        if (pending && typeof pending.then === "function") pending.then(function () {}, failed);
        else failed();
      } else if (legacy()) show();
    });
  });

  function runCount(el) {
    var raw = el.getAttribute("data-count") || "";
    var target = Number(String(raw).replace(/,/g, ""));
    if (!raw || !Number.isFinite(target)) return;
    var initial = el.textContent;
    if (reduce) return;
    var start = 0;
    var dur = 1200;
    var t0 = 0;
    function frame(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(start + (target - start) * eased));
      if (p < 1) window.requestAnimationFrame(frame);
      else el.textContent = initial;
    }
    el.textContent = "0";
    window.requestAnimationFrame(frame);
  }

  function armEnter() {
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var pending = [];
    var laterCounts = [];
    if (!reduce) {
      document.querySelectorAll("[data-enter]").forEach(function (el) {
        if (el.getBoundingClientRect().top >= vh) {
          el.classList.add("is-pending");
          pending.push(el);
        }
      });
      document.querySelectorAll("[data-count]").forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < vh) runCount(el);
        else laterCounts.push(el);
      });
    }
    if (!pending.length && !laterCounts.length) return;
    if (!("IntersectionObserver" in window)) {
      pending.forEach(function (el) { el.classList.remove("is-pending"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.hasAttribute("data-enter")) el.classList.add("is-in");
        if (el.hasAttribute("data-count")) runCount(el);
        io.unobserve(el);
      });
    }, { threshold: 0.2 });
    pending.forEach(function (el) { io.observe(el); });
    laterCounts.forEach(function (el) { io.observe(el); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", armEnter);
  else armEnter();

  document.querySelectorAll("[data-carousel]").forEach(function (root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll("[data-slide]"));
    var dots = Array.prototype.slice.call(root.querySelectorAll("[data-carousel-dot]"));
    var prev = root.querySelector("[data-carousel-prev]");
    var next = root.querySelector("[data-carousel-next]");
    var index = 0;
    var timer = 0;
    var interval = Number(root.getAttribute("data-interval") || "4000");
    if (!Number.isFinite(interval) || interval < 3000 || interval > 5000) interval = 4000;

    function show(i) {
      if (!slides.length) return;
      index = (i + slides.length) % slides.length;
      slides.forEach(function (slide, n) {
        slide.classList.toggle("is-current", n === index);
      });
      dots.forEach(function (dot, n) {
        if (n === index) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }

    function stop() {
      if (timer) window.clearInterval(timer);
      timer = 0;
    }

    function play() {
      stop();
      if (reduce || slides.length < 2) return;
      timer = window.setInterval(function () { show(index + 1); }, interval);
    }

    if (prev) prev.addEventListener("click", function () { show(index - 1); play(); });
    if (next) next.addEventListener("click", function () { show(index + 1); play(); });
    dots.forEach(function (dot, n) {
      dot.addEventListener("click", function () { show(n); play(); });
    });
    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", play);
    root.addEventListener("focusin", stop);
    root.addEventListener("focusout", play);
    show(0);
    play();
  });

  var dock = document.querySelector("[data-float]");
  if (dock) {
    if (reduce || !window.matchMedia || !("IntersectionObserver" in window)) {
      dock.classList.add("is-dock");
    } else {
      var desktop = window.matchMedia("(min-width: 1024px)");
      var mark = document.createElement("div");
      mark.setAttribute("data-fold-mark", "");
      mark.setAttribute("aria-hidden", "true");
      document.body.appendChild(mark);
      function placeDock() {
        if (!desktop.matches) {
          dock.classList.add("is-dock");
          return;
        }
        var rect = mark.getBoundingClientRect();
        dock.classList.toggle("is-dock", rect.top <= 0);
      }
      var foldWatch = new IntersectionObserver(function () { placeDock(); }, { threshold: [0, 1] });
      foldWatch.observe(mark);
      if (typeof desktop.addEventListener === "function") desktop.addEventListener("change", placeDock);
      placeDock();
    }

    /* 悬浮条实际高度写到 --dock-h：窄屏时页脚按它垫底。
       桌面右下角的悬浮条：页脚进到它头顶时加 is-over-foot（样式里让开），页脚底部不用再垫空白。 */
    var footer = document.querySelector(".site-footer");
    var footWatch = 0;
    var lastHeight = 0;
    var armFootWatch = function (height) {
      if (!footer || !("IntersectionObserver" in window)) return;
      if (footWatch) footWatch.disconnect();
      footWatch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          dock.classList.toggle("is-over-foot", entry.isIntersecting);
        });
      }, { rootMargin: "0px 0px -" + (height + 24) + "px 0px", threshold: 0 });
      footWatch.observe(footer);
    };
    var measureDock = function () {
      var height = Math.ceil(dock.getBoundingClientRect().height);
      if (!height || Math.abs(height - lastHeight) < 2) return;
      lastHeight = height;
      document.documentElement.style.setProperty("--dock-h", height + "px");
      armFootWatch(height);
    };
    measureDock();
    if ("ResizeObserver" in window) new ResizeObserver(measureDock).observe(dock);
    else window.addEventListener("resize", measureDock);
  }
})();
