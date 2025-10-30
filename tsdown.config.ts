import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  clean: true,
  sourcemap: false,
  format: ["esm", "cjs"],
  target: "es2020",
  fixedExtension: true,
  inputOptions(defaults) {
    const define = Reflect.get(defaults, "define") as Record<string, string> | undefined;
    const inject = Reflect.get(defaults, "inject") as Record<string, string> | undefined;
    const hasDefine = define && Object.keys(define).length > 0;
    const hasInject = inject && Object.keys(inject).length > 0;
    const baseTransform = defaults.transform ?? {};
    const transform: Record<string, unknown> = { ...baseTransform };

    if (hasDefine) {
      transform.define = { ...define };
    }

    if (hasInject) {
      transform.inject = { ...inject };
    }

    defaults.transform = transform;
    Reflect.deleteProperty(defaults, "define");
    Reflect.deleteProperty(defaults, "inject");

    return defaults;
  },
});
