const routeRegistry = [];
const safeMethods = new Set(["GET", "HEAD"]);
const validRoles = new Set(["viewer", "editor", "admin", "service"]);

function defineRoute(route) {
  if (!route?.id || !route.method || !route.path || typeof route.handler !== "function") {
    throw new Error("接口注册信息不完整");
  }
  const method = String(route.method).toUpperCase();
  const path = String(route.path);
  const bodyLimitBytes = route.bodyLimitBytes ?? 1024 * 1024;
  if (![undefined, true, false, "optional"].includes(route.auth)) {
    throw new Error(`接口认证策略无效：${route.id}`);
  }
  if (!path.startsWith("/")) throw new Error(`接口路径必须以 / 开头：${path}`);
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new Error(`接口请求体字节上限无效：${route.id}`);
  }
  if (routeRegistry.some((item) => item.id === route.id)) {
    throw new Error(`接口 id 重复：${route.id}`);
  }
  const pathSignature = path.replace(/:([A-Za-z0-9_]+)/g, ":");
  if (routeRegistry.some((item) => item.method === method && item.pathSignature === pathSignature)) {
    throw new Error(`接口 method/path 重复：${method} ${path}`);
  }

  const roles = normalizeRoles(route.roles, method, route.auth);
  const registeredRoute = {
    tags: [],
    summary: "",
    ...route,
    method,
    path,
    bodyLimitBytes,
    roles,
    pathSignature,
    matcher: compilePath(path),
  };
  routeRegistry.push(registeredRoute);
  return registeredRoute;
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

function findRoutesByPath(pathname) {
  const matches = [];
  for (const route of routeRegistry) {
    const params = route.matcher(pathname);
    if (params) matches.push({ route, params });
  }
  return matches;
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

function normalizeRoles(roles, method, auth) {
  if (auth === false) return [];
  const values = roles == null ? [safeMethods.has(method) ? "viewer" : "editor"] : roles;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("受保护接口必须配置至少一个角色");
  }
  const normalized = [...new Set(values.map((role) => String(role)))];
  normalized.forEach((role) => {
    if (!validRoles.has(role)) throw new Error(`接口使用了无效角色：${role}`);
  });
  return normalized;
}

export { defineRoute, findRoute, findRoutesByPath, getRoutes };
