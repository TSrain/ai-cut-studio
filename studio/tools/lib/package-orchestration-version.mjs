// Validate execution boundaries only; historical job reads must remain available.
export function resolvePackageOrchestrationVersion(version) {
  if (version === 1)
    throw Error('packageOrchestrationVersion=1 已下线（见 git tag v1-final），请新建 v2 package 任务');
  if (version !== undefined && version !== 2)
    throw Error('Unsupported package orchestration version');
  return 2;
}
