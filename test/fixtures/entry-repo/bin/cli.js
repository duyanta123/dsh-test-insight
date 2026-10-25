#!/usr/bin/env node
import { handle } from "../src/gateway.js";

const [input] = process.argv.slice(2);
console.log(handle(input));
