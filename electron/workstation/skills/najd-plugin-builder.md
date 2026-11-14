---
name: najd-plugin-builder
description: Create and package a personal NAJD plugin. Use when the user wants to turn tools or skills into an installable package.
---

# Plugin builder

A package is a zip with najd-package.json at its root and its files. The manifest needs schemaVersion 1, id, displayName, version, publisher.name, description, categories, permissions, dependencies, compatibility (os, arch, minNajd), integrity.sha256 and license.

integrity.sha256 is the SHA-256 of the lines "path NUL sha256(file) newline" for every file except the manifest, sorted by path. Skills go in folders named in "skills", each with SKILL.md. An executable file needs a declared "execute" permission.

Write the files, compute the digest with Python, zip them, and tell the user to choose the file under Skills & Plugins, Add new. Nothing in a package runs at install.
