const routeRegistry = [];

function defineRoute(route) {
  if (!route?.id || !route.method || !route.path || typeof route.handler !== "function") {
    throw new Error("接口注册信息不完整");
  }
  if (routeRegistry.some((item) => item.id === route.id)) {
    throw new Error(`接口 id 重复：${route.id}`);
  }
  routeRegistry.push({
    tags: [],
    summary: "",
    bodyLimitBytes: 80 * 1024 * 1024,
    ...route,
    method: String(route.method).toUpperCase(),
    matcher: compilePath(route.path),
  });
}

function getRoutes() {
  return routeRegistry.slice();
}

function findRoute(method, pathname) {
  const normalizedMethod = String(method || "").toUpperCase();
  for (const route of routeRegistry) {
    if (route.method !== normalizedMethod) continue;
    const params = route.matcher(pathname);
    if (params) return { route, params };
  }
  return null;
}

function compilePath(path) {
  const names = [];
  const pattern = String(path)
    .split("/")
    .map((part) => {
      const param = part.match(/^:([A-Za-z0-9_]+)$/);
      if (param) {
        names.push(param[1]);
        return "([^/]+)";
      }
      return escapeRegex(part);
    })
    .join("/");
  const regex = new RegExp(`^${pattern}$`);
  return (pathname) => {
    const match = regex.exec(pathname);
    if (!match) return null;
    return names.reduce((params, name, index) => {
      params[name] = decodeURIComponent(match[index + 1] || "");
      return params;
    }, {});
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { defineRoute, findRoute, getRoutes };
