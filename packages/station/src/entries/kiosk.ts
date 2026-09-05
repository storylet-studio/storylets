// The kiosk page's entry. One line of glue per app, so the apps themselves are
// testable without a document to boot from.
/// <reference lib="dom" />
import { startKiosk } from "../kiosk.js";
import { mount } from "./mount.js";

mount(startKiosk);
