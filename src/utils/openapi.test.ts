import { describe, expect, it } from "vitest";
import { exportOpenApi, openApiToMockRoutes } from "./openapi";
import type { Collection, KeyValue } from "../types";

const kv = (key: string, value: string): KeyValue => ({
  id: `kv-${key}`,
  key,
  value,
  enabled: true,
});

const sampleCollection: Collection = {
  id: "col-1",
  name: "Pet Store API",
  description: "A sample pet store collection",
  requests: [
    {
      id: "r1",
      name: "List Pets",
      method: "GET",
      url: "https://api.example.com/pets",
      headers: [kv("Accept", "application/json")],
      params: [kv("limit", "10"), kv("offset", "0")],
      body: "",
      body_type: "none",
      created_at: 1000,
      updated_at: 1000,
    },
    {
      id: "r2",
      name: "Create Pet",
      method: "POST",
      url: "https://api.example.com/pets",
      headers: [kv("Content-Type", "application/json")],
      params: [],
      body: '{"name":"Fido","age":3}',
      body_type: "json",
      created_at: 1000,
      updated_at: 1000,
    },
  ],
  folders: [
    {
      id: "f1",
      name: "Individual",
      requests: [
        {
          id: "r3",
          name: "Get Pet",
          method: "GET",
          url: "https://api.example.com/pets/:petId",
          headers: [],
          params: [],
          body: "",
          body_type: "none",
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: "r4",
          name: "Delete Pet",
          method: "DELETE",
          url: "https://api.example.com/pets/:petId",
          headers: [],
          params: [],
          body: "",
          body_type: "none",
          created_at: 1000,
          updated_at: 1000,
        },
      ],
      folders: [],
    },
  ],
  created_at: 1000,
  updated_at: 1000,
};

interface ExportedOperation {
  summary?: string;
  operationId?: string;
  parameters?: { name: string; in: string; required?: boolean; schema?: { type: string } }[];
  requestBody?: { content: Record<string, { schema?: { type: string }; example?: unknown }> };
  responses: Record<string, { description: string }>;
  tags?: string[];
}

interface ExportedSpec {
  openapi: string;
  info: { title: string; description?: string; version: string };
  paths: Record<string, Record<string, ExportedOperation>>;
  tags?: { name: string }[];
}

describe("exportOpenApi", () => {
  it("produces a valid OpenAPI 3.0.3 JSON string with info / paths", () => {
    const json = exportOpenApi(sampleCollection);
    const spec = JSON.parse(json) as ExportedSpec;
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("Pet Store API");
    expect(spec.info.description).toBe("A sample pet store collection");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("groups requests under the correct path + method", () => {
    const spec = JSON.parse(exportOpenApi(sampleCollection)) as ExportedSpec;
    expect(spec.paths["/pets"]).toBeDefined();
    expect(spec.paths["/pets"].get).toBeDefined();
    expect(spec.paths["/pets"].post).toBeDefined();
    expect(spec.paths["/pets/{petId}"]).toBeDefined();
    expect(spec.paths["/pets/{petId}"].get).toBeDefined();
    expect(spec.paths["/pets/{petId}"].delete).toBeDefined();
  });

  it("includes query parameters with guessed types", () => {
    const spec = JSON.parse(exportOpenApi(sampleCollection)) as ExportedSpec;
    const params = spec.paths["/pets"].get.parameters ?? [];
    const limit = params.find((p) => p.name === "limit");
    expect(limit).toBeDefined();
    expect(limit?.in).toBe("query");
    expect(limit?.schema?.type).toBe("number");
  });

  it("converts :param to {param} path parameters", () => {
    const spec = JSON.parse(exportOpenApi(sampleCollection)) as ExportedSpec;
    expect(spec.paths["/pets/{petId}"]).toBeDefined();
    const params = spec.paths["/pets/{petId}"].get.parameters ?? [];
    const pathParam = params.find((p) => p.name === "petId");
    expect(pathParam).toBeDefined();
    expect(pathParam?.in).toBe("path");
    expect(pathParam?.required).toBe(true);
  });

  it("includes request body with example for JSON bodies", () => {
    const spec = JSON.parse(exportOpenApi(sampleCollection)) as ExportedSpec;
    const postOp = spec.paths["/pets"].post;
    expect(postOp.requestBody).toBeDefined();
    expect(postOp.requestBody?.content["application/json"]).toBeDefined();
    expect(postOp.requestBody?.content["application/json"].example).toEqual({
      name: "Fido",
      age: 3,
    });
  });

  it("assigns folder names as tags", () => {
    const spec = JSON.parse(exportOpenApi(sampleCollection)) as ExportedSpec;
    expect(spec.tags).toHaveLength(1);
    expect(spec.tags?.[0].name).toBe("Individual");
    const getOp = spec.paths["/pets/{petId}"].get;
    expect(getOp.tags).toContain("Individual");
  });

  it("skips Content-Type from header parameters (implied by requestBody)", () => {
    const spec = JSON.parse(exportOpenApi(sampleCollection)) as ExportedSpec;
    const postParams = spec.paths["/pets"].post.parameters ?? [];
    const ct = postParams.find((p) => p.name === "Content-Type");
    expect(ct).toBeUndefined();
  });
});

describe("openApiToMockRoutes", () => {
  const spec = exportOpenApi(sampleCollection);

  it("generates one mock route per operation", () => {
    const routes = openApiToMockRoutes(spec);
    expect(routes).toHaveLength(4);
  });

  it("uses :param syntax for path parameters", () => {
    const routes = openApiToMockRoutes(spec);
    const petRoutes = routes.filter((r) => r.path.includes(":petId"));
    expect(petRoutes).toHaveLength(2);
    expect(petRoutes[0].path).toBe("/pets/:petId");
  });

  it("sets correct uppercase HTTP methods", () => {
    const routes = openApiToMockRoutes(spec);
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST"]);
  });

  it("all routes have status, headers, body, and enabled=true", () => {
    const routes = openApiToMockRoutes(spec);
    for (const r of routes) {
      expect(r.status).toBeGreaterThanOrEqual(200);
      expect(r.enabled).toBe(true);
      expect(Array.isArray(r.headers)).toBe(true);
      expect(typeof r.body).toBe("string");
    }
  });

  it("falls back to a JSON body when the spec has no response content", () => {
    const minimalSpec = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/ping": {
          get: {
            summary: "Ping",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const routes = openApiToMockRoutes(minimalSpec);
    expect(routes).toHaveLength(1);
    expect(routes[0].body).toContain("Ping");
    expect(routes[0].headers.find((h) => h.key === "Content-Type")?.value).toBe(
      "application/json",
    );
  });

  it("uses the first 2xx response when multiple status codes exist", () => {
    const spec = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/u": {
          get: {
            responses: {
              "404": { description: "not found" },
              "201": {
                description: "created",
                content: { "application/json": { example: { ok: true } } },
              },
            },
          },
        },
      },
    });
    const routes = openApiToMockRoutes(spec);
    expect(routes).toHaveLength(1);
    expect(routes[0].status).toBe(201);
    expect(routes[0].body).toBe('{\n  "ok": true\n}');
  });

  it("synthesizes a sample value from a schema when no example is present", () => {
    const spec = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/u": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        name: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const routes = openApiToMockRoutes(spec);
    const parsed = JSON.parse(routes[0].body) as Record<string, unknown>;
    expect(parsed).toHaveProperty("id");
    expect(parsed).toHaveProperty("name");
  });
});
