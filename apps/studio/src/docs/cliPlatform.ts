export type CliPlatform = 'linux' | 'mac' | 'windows';
export const CLI_PLATFORM_MARKER = '<!-- cli-platform -->';

/** Keep platform prose in the authored guide, beside the commands it explains. */
export function cliPlatformMarkdown(content: string, platform: CliPlatform): string {
  if (!content.includes(CLI_PLATFORM_MARKER)) return content;
  let result = content.replace(/<!-- cli:(linux|mac|windows) -->([\s\S]*?)<!-- \/cli -->/g,
    (_, name: string, body: string) => name === platform ? body : '');
  result = result.replaceAll('terminal-linux-', `terminal-${platform}-`);
  if (platform === 'windows') {
    result = result.replaceAll('~/Downloads/openldr_ce/data/my-file.json', 'C:\\openldr_ce\\data\\my-file.json')
      .replaceAll('~/Downloads/openldr_ce/files/my-file.json', 'C:\\openldr_ce\\files\\my-file.json')
      .replaceAll('~/Downloads/openldr_ce/', 'C:\\openldr_ce\\')
      .replaceAll('~/Downloads/openldr_ce', 'C:\\openldr_ce')
      .replaceAll('./openldr', '.\\openldr.ps1')
      .replaceAll('`openldr`', '`openldr.ps1`')
      .replaceAll('\n  openldr\n', '\n  openldr.ps1\n')
      .replaceAll('\nls\n', '\nGet-ChildItem -Name\n')
      .replaceAll('unset DOCKER_HOST', '$env:DOCKER_HOST = $null');
  }
  return result;
}
