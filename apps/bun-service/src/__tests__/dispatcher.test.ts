import { describe, expect, test } from "bun:test";
import { dispatch, listMethods, registerCommand } from "../dispatcher";
import { JSON_RPC_ERRORS } from "../types";

describe("dispatcher", () => {
  test("system.ping returns 'pong'", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "system.ping",
    });
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: "pong",
    });
  });

  test("system.version returns the current version", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "system.version",
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: { version: expect.any(String) },
    });
  });

  test("unknown method yields error -32601", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "no.such.method",
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND },
    });
  });

  test("invalid jsonrpc version yields -32600", async () => {
    const response = await dispatch({
      // @ts-expect-error testing invalid input
      jsonrpc: "1.0",
      id: 4,
      method: "system.ping",
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      error: { code: JSON_RPC_ERRORS.INVALID_REQUEST },
    });
  });

  test("notifications (no id) return null", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      method: "system.ping",
    });
    expect(response).toBeNull();
  });

  test("handler errors map to -32603", async () => {
    registerCommand("test.boom", () => {
      throw new Error("boom");
    });
    const response = await dispatch({
      jsonrpc: "2.0",
      id: 5,
      method: "test.boom",
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 5,
      error: { code: JSON_RPC_ERRORS.INTERNAL_ERROR, message: "boom" },
    });
  });

  test("listMethods includes system.ping", async () => {
    const methods = await listMethods();
    expect(methods).toContain("system.ping");
  });
});
