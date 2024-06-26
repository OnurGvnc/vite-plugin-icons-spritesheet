/*eslint-disable no-console */
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { parse } from "node-html-parser";
import chalk from "chalk";
import type { Plugin } from "vite";
import { normalizePath } from "vite";
import { mkdir } from "fs/promises";

interface PluginProps {
  withTypes?: boolean;
  inputDir: string;
  outputDir: string;
  fileName?: string;
  cwd?: string;
}

const generateIcons = async ({ withTypes = false, inputDir, outputDir, cwd, fileName = "sprite.svg" }: PluginProps) => {
  const cwdToUse = cwd ?? process.cwd();
  const inputDirRelative = path.relative(cwdToUse, inputDir);
  const outputDirRelative = path.relative(cwdToUse, outputDir);

  const files = glob.sync("**/*.svg", {
    cwd: inputDir,
  });
  if (files.length === 0) {
    console.log(`⚠️  No SVG files found in ${chalk.red(inputDirRelative)}`);
    return;
  }

  await mkdir(outputDirRelative, { recursive: true });
  await generateSvgSprite({
    files,
    inputDir,
    outputPath: path.join(outputDir, fileName),
    outputDirRelative,
  });
  if (withTypes) {
    await generateTypes({
      names: files.map((file: string) => fileNameToCamelCase(file.replace(/\.svg$/, ""))),
      outputPath: path.join(outputDir, "types.ts"),
    });
  }
};

function fileNameToCamelCase(fileName: string): string {
  const words = fileName.split("-");
  const capitalizedWords = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return capitalizedWords.join("");
}
/**
 * Creates a single SVG file that contains all the icons
 */
async function generateSvgSprite({
  files,
  inputDir,
  outputPath,
  outputDirRelative,
}: {
  files: string[];
  inputDir: string;
  outputPath: string;
  outputDirRelative?: string;
}) {
  // Each SVG becomes a symbol and we wrap them all in a single SVG
  const symbols = await Promise.all(
    files.map(async (file) => {
      const fileName = fileNameToCamelCase(file.replace(/\.svg$/, ""));
      const input = await fs.readFile(path.join(inputDir, file), "utf8");

      const root = parse(input);
      const svg = root.querySelector("svg");
      if (!svg) {
        console.log(`⚠️ No SVG tag found in ${file}`);
        return;
      }
      svg.tagName = "symbol";
      svg.setAttribute("id", fileName);
      svg.removeAttribute("xmlns");
      svg.removeAttribute("xmlns:xlink");
      svg.removeAttribute("version");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      return svg.toString().trim();
    })
  );
  const output = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0">',
    "<defs>", // for semantics: https://developer.mozilla.org/en-US/docs/Web/SVG/Element/defs
    ...symbols.filter(Boolean),
    "</defs>",
    "</svg>",
  ].join("\n");

  return writeIfChanged(outputPath, output, `🖼️  Generated SVG spritesheet in ${chalk.green(outputDirRelative)}`);
}

async function generateTypes({ names, outputPath }: { names: string[]; outputPath: string }) {
  const output = [
    "// This file is generated by icon spritesheet generator",
    "",
    "export type IconName =",
    ...names.map((name) => `  | "${name}"`),
    "",
    "export const iconNames = [",
    ...names.map((name) => `  "${name}",`),
    "] as const",
    "",
  ].join("\n");

  const file = await writeIfChanged(
    outputPath,
    output,
    `${chalk.blueBright("TS")} Generated icon types in ${chalk.green(outputPath)}`
  );
  return file;
}

/**
 * Each write can trigger dev server reloads
 * so only write if the content has changed
 */
async function writeIfChanged(filepath: string, newContent: string, message: string) {
  try {
    const currentContent = await fs.readFile(filepath, "utf8");
    if (currentContent !== newContent) {
      await fs.writeFile(filepath, newContent, "utf8");
      console.log(message);
    }
  } catch (e) {
    // File doesn't exist yet
    await fs.writeFile(filepath, newContent, "utf8");
    console.log(message);
  }
}

export const iconsSpritesheet: (args: PluginProps) => Plugin = ({ withTypes, inputDir, outputDir, fileName, cwd }) => ({
  name: "icon-spritesheet-generator",
  apply(config) {
    return config.mode === "development";
  },
  async configResolved(config) {
    const outputSvgPath = normalizePath(path.join(cwd ?? process.cwd(), outputDir, fileName ?? "sprite.svg"));
    const outputSvgExists = await fs
      .access(outputSvgPath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (!outputSvgExists) {
      await generateIcons({
        withTypes,
        inputDir,
        outputDir,
        fileName,
      });
    }
  },
  async watchChange(file, type) {
    const inputPath = normalizePath(path.join(cwd ?? process.cwd(), inputDir));
    if (file.includes(inputPath) && file.endsWith(".svg") && ["create", "delete"].includes(type.event)) {
      await generateIcons({
        withTypes,
        inputDir,
        outputDir,
        fileName,
      });
    }
  },
  async handleHotUpdate({ file }) {
    const inputPath = normalizePath(path.join(cwd ?? process.cwd(), inputDir));
    if (file.includes(inputPath) && file.endsWith(".svg")) {
      await generateIcons({
        withTypes,
        inputDir,
        outputDir,
        fileName,
      });
    }
  },
});
