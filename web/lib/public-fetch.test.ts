import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAddress } from "./public-fetch.ts";

test("SSRF: ιδιωτικά, loopback και link-local IPv4 αποκλείονται", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254", "0.0.0.0", "100.64.0.1", "198.18.0.1", "224.0.0.1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1"]) assert.equal(isPublicAddress(address), true, address);
});

test("SSRF: IPv6 και IPv4-mapped μορφές δεν παρακάμπτουν τον έλεγχο", () => {
  for (const address of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "2001:db8::1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(address), true, address);
});
