import type { CommandMap } from "../types";

const handlers: CommandMap = {
  "system.ping": () => "pong",
  "system.version": () => ({ version: "0.2.0" }),
};

export default handlers;
