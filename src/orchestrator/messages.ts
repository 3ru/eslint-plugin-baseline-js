import { baselineYearLabel, getFeatureRecord } from "../baseline/resolve";
import type {
  CallMemberWithArgsDescriptor,
  Descriptor,
  NewWithOptionsDescriptor,
} from "../baseline/types";
import type { BaselineOption } from "../config";

export function baselineMessage(featureId: string, baseline: BaselineOption, subject?: string) {
  const feature = getFeatureRecord(featureId);
  const label = subject ?? `'${feature?.name ?? featureId}'`;

  if (baseline === "widely") {
    return `${label} is not Baseline Widely available (${featureId}).`;
  }

  if (baseline === "newly") {
    return `${label} is not Baseline Newly available (${featureId}).`;
  }

  if (feature?.status?.baseline === false) {
    return `${label} has Limited availability and exceeds ${baseline} (${featureId}).`;
  }

  const year = baselineYearLabel(feature?.status) ?? "unknown";

  return `${label} became Baseline in ${year} and exceeds ${baseline} (${featureId}).`;
}

export function descriptorSubject(descriptor: Descriptor): string {
  switch (descriptor.kind) {
    case "newIdent":
    case "callGlobal":
      return `'${descriptor.name}'`;
    case "newMember":
    case "callStatic":
    case "member":
    case "staticMember":
      return `'${descriptor.prop}' on ${descriptor.base}`;
    case "instanceMember":
      return `'${descriptor.prop}' on ${descriptor.iface}`;
    case "callMemberWithArgs":
    case "newWithOptions":
      return callSubject(descriptor);
  }
}

function callSubject(descriptor: CallMemberWithArgsDescriptor | NewWithOptionsDescriptor) {
  const args: string[] = [];
  const objectArg = descriptor.objectArg;

  if (descriptor.kind === "callMemberWithArgs" && descriptor.stringArg) {
    args[descriptor.stringArg.index] = descriptor.stringArg.values
      .map((value) => JSON.stringify(value))
      .join(" | ");
  }

  if (objectArg) {
    const properties = new Map<string, string>();

    for (const key of objectArg.hasKeys ?? []) {
      properties.set(key, "...");
    }

    for (const { key, values } of objectArg.keyValues ?? []) {
      properties.set(key, values?.map((value) => JSON.stringify(value)).join(" | ") || "...");
    }

    args[objectArg.index] =
      `{ ${Array.from(properties, ([key, value]) => `${key}: ${value}`).join(", ")} }`;
  }

  const argumentsText = Array.from(args, (argument) => argument ?? "...").join(", ");

  if (descriptor.kind === "newWithOptions") {
    return `new ${descriptor.name}(${argumentsText})`;
  }

  const receiver = descriptor.viaCall ? `${descriptor.viaCall.prop}().` : "";

  return `${receiver}${descriptor.prop}(${argumentsText})`;
}
