param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$launch = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$env:DROID_AUTOCOMPLETE_NATIVE_RESULT = $launch.resultPath
$env:FACTORY_API_KEY = ''
$env:ELECTRON_RUN_AS_NODE = ''
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class DroidIsolatedDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public uint cb; public string reserved; public string desktop; public string title;
    public uint x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
    public short showWindow, reserved2; public IntPtr reservedPointer, stdInput, stdOutput, stdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr process, thread; public uint processId, threadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct BASIC_LIMIT_INFORMATION {
    public long processTime, jobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet;
    public uint activeProcessLimit; public UIntPtr affinity; public uint priorityClass, schedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS { public ulong readOperations, writeOperations, otherOperations, readBytes, writeBytes, otherBytes; }
  [StructLayout(LayoutKind.Sequential)]
  struct EXTENDED_LIMIT_INFORMATION {
    public BASIC_LIMIT_INFORMATION basic; public IO_COUNTERS io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
  [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes,
    IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
    ref STARTUPINFO startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref EXTENDED_LIMIT_INFORMATION limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static int Run(string executable, string commandLine, string directory, uint timeout) {
    string name = "DroidAutocompleteTest-" + Guid.NewGuid().ToString("N");
    IntPtr desktop = CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, 0x01ff, IntPtr.Zero);
    Check(desktop != IntPtr.Zero);
    IntPtr job = IntPtr.Zero;
    PROCESS_INFORMATION process = new PROCESS_INFORMATION();
    bool assigned = false;
    try {
      job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
      var limits = new EXTENDED_LIMIT_INFORMATION(); limits.basic.flags = 0x2000;
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
      var startup = new STARTUPINFO(); startup.cb = (uint)Marshal.SizeOf(startup);
      startup.desktop = name; startup.flags = 1; startup.showWindow = 0;
      Check(CreateProcess(executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false,
        0x08000004, IntPtr.Zero, directory, ref startup, out process));
      Check(AssignProcessToJobObject(job, process.process)); assigned = true;
      Check(ResumeThread(process.thread) != 0xffffffff);
      uint wait = WaitForSingleObject(process.process, timeout);
      if (wait == 258) throw new TimeoutException("Isolated autocomplete host exceeded its time limit.");
      Check(wait == 0);
      uint exitCode; Check(GetExitCodeProcess(process.process, out exitCode));
      return unchecked((int)exitCode);
    } finally {
      // The job contains only this run's process tree; closing it stops remaining children.
      if (!assigned && process.process != IntPtr.Zero) TerminateProcess(process.process, 1);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
      if (process.process != IntPtr.Zero) CloseHandle(process.process);
      CloseDesktop(desktop);
    }
  }
}
"@
exit [DroidIsolatedDesktop]::Run($launch.executable, $launch.commandLine, $launch.directory, $launch.timeoutMs)
