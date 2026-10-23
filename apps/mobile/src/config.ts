import Constants from "expo-constants";

/** Server address from app.json `extra.apiUrl`; a build for testers sets it to the test server. */
export const API_URL: string = String(Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:8080").replace(/\/$/, "");

export const WS_URL = `${API_URL.replace(/^http/, "ws")}/v1/ws`;

export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";
