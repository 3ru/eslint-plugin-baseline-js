import type { MemberExpression } from "estree";
import type ts from "typescript";
import { getIncludedDescriptors } from "../../baseline/loader";
import type { InstanceMemberDescriptor } from "../../baseline/types";
import { getStaticMemberName } from "../../util/ast";
import type { TypedParserServices } from "../../util/typed-parser-services";

const instanceDescriptors = new Map<string, Map<string, InstanceMemberDescriptor[]>>();
for (const descriptor of getIncludedDescriptors({ webApis: true, jsBuiltins: true })) {
  if (descriptor.kind !== "instanceMember") continue;
  let owners = instanceDescriptors.get(descriptor.prop);
  if (!owners) {
    owners = new Map();
    instanceDescriptors.set(descriptor.prop, owners);
  }
  const descriptors = owners.get(descriptor.iface);
  if (descriptors) descriptors.push(descriptor);
  else owners.set(descriptor.iface, [descriptor]);
}

export interface TypedMemberResolver {
  selectInstanceDescriptors(member: MemberExpression): readonly InstanceMemberDescriptor[];
  provesOwner(member: MemberExpression, iface: string): boolean;
}

export function createTypedMemberResolver(services: TypedParserServices): TypedMemberResolver {
  const { program, esTreeNodeToTSNodeMap } = services;
  const checker = program.getTypeChecker();

  function isLibrarySymbol(symbol: ts.Symbol): boolean {
    return !!symbol
      .getDeclarations()
      ?.some((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
  }

  function receiverBranches(member: MemberExpression): readonly ts.Type[] {
    const node = esTreeNodeToTSNodeMap.get(member.object);
    if (!node) return [];
    let type = checker.getNonNullableType(checker.getTypeAtLocation(node));
    const seen = new Set<ts.Type>();
    while (!seen.has(type)) {
      seen.add(type);
      const constraint = checker.getBaseConstraintOfType(type);
      if (!constraint || constraint === type) break;
      type = checker.getNonNullableType(constraint);
    }
    return type.isUnion() ? type.types : [type];
  }

  function hasLibraryMember(type: ts.Type, prop: string): boolean {
    const symbol = checker.getPropertyOfType(type, prop);
    if (!symbol) return false;
    const roots = checker.getRootSymbols(symbol);
    return roots.length === 1 && roots.every(isLibrarySymbol);
  }

  function* ownerLevels(type: ts.Type, prop: string): Generator<ReadonlyMap<string, ts.Type>> {
    if (!hasLibraryMember(type, prop)) return;
    const seen = new Set<ts.Type>();
    let level = [type];
    while (level.length) {
      const owners = new Map<string, ts.Type>();
      const bases: ts.Type[] = [];
      for (const current of level) {
        if (seen.has(current)) continue;
        seen.add(current);
        if (current.isIntersection()) level.push(...current.types);
        const apparent = checker.getApparentType(current);
        if (apparent !== current) level.push(apparent);
        const constraint = checker.getBaseConstraintOfType(current);
        if (constraint && constraint !== current) level.push(constraint);
        if (isTypeReference(current) && current.target !== current) level.push(current.target);

        const symbol = current.getSymbol();
        if (symbol && isLibrarySymbol(symbol)) {
          owners.set(symbol.getName(), current);
        }
        bases.push(...(current.getBaseTypes() ?? []));
      }
      yield owners;
      level = bases;
    }
  }

  return {
    selectInstanceDescriptors(member) {
      const prop = getStaticMemberName(member);
      const candidates = prop === null ? undefined : instanceDescriptors.get(prop);
      if (!candidates || prop === null) return [];
      const selected = new Set<InstanceMemberDescriptor>();
      for (const branch of receiverBranches(member)) {
        for (const owners of ownerLevels(branch, prop)) {
          const matches = [...owners.keys()].filter((owner) => candidates.has(owner));
          if (!matches.length) continue;
          if (matches.length === 1) {
            for (const descriptor of candidates.get(matches[0]) ?? []) selected.add(descriptor);
          }
          break;
        }
      }
      return [...selected];
    },
    provesOwner(member, iface) {
      const prop = getStaticMemberName(member);
      if (prop === null) return false;
      const branches = receiverBranches(member);
      return (
        branches.length > 0 &&
        branches.every((branch) => {
          for (const owners of ownerLevels(branch, prop)) {
            const owner = owners.get(iface);
            if (owner && hasLibraryMember(owner, prop)) return true;
          }
          return false;
        })
      );
    },
  };
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return "target" in type;
}
