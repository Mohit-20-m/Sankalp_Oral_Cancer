import { isMockMode } from "./api";
import type { Services } from "./contracts";
import { mockServices } from "@/mocks/mockServices";
import { httpServices } from "./http";

/** Screens import `services` from here — never mocks or http directly. */
export const services: Services = isMockMode ? mockServices : httpServices;
export * from "./contracts";
