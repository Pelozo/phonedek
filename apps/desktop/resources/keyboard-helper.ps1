# PhoneDeck Windows keyboard helper.
# Started once by the Electron main process. Reads one JSON command per line
# from stdin and writes one JSON response per line to stdout.
#
# Command: {"id":"1","steps":[{"kind":"keys","keys":["CTRL","C"],"holdMs":35}, ...]}
# Response: {"id":"1","ok":true} or {"id":"1","ok":false,"error":"..."}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PhoneDeckNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION u;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT point, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public static void EnableDpiAwareness() {
        try {
            // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4. GetCursorPos and
            // SetCursorPos then use physical pixels on every monitor.
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        } catch (Exception) {
            // Older Windows builds do not export this entry point.
        }
        try { SetProcessDPIAware(); } catch (Exception) { }
    }

    public static int MonitorHeightAt(int x, int y) {
        try {
            POINT point = new POINT();
            point.X = x;
            point.Y = y;
            IntPtr monitor = MonitorFromPoint(point, 2); // MONITOR_DEFAULTTONEAREST
            if (monitor != IntPtr.Zero) {
                MONITORINFO info = new MONITORINFO();
                info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                if (GetMonitorInfo(monitor, ref info)) {
                    int height = info.rcMonitor.Bottom - info.rcMonitor.Top;
                    if (height > 0) return height;
                }
            }
        } catch (Exception) { }
        int fallback = GetSystemMetrics(1); // SM_CYSCREEN
        return fallback > 0 ? fallback : 1080;
    }

    public static void UnicodeChar(ushort codeUnit) {
        INPUT down = new INPUT();
        down.type = 1;
        down.u.ki.wVk = 0;
        down.u.ki.wScan = codeUnit;
        down.u.ki.dwFlags = 0x0004; // KEYEVENTF_UNICODE
        down.u.ki.time = 0;
        down.u.ki.dwExtraInfo = IntPtr.Zero;
        SendInput(1, new INPUT[] { down }, Marshal.SizeOf(typeof(INPUT)));

        INPUT up = down;
        up.u.ki.dwFlags = 0x0004 | 0x0002; // KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
        SendInput(1, new INPUT[] { up }, Marshal.SizeOf(typeof(INPUT)));
    }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
        [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

// Per-application sessions. IAudioSessionManager2 inherits the two
// IAudioSessionManager methods, so they stay first in vtable order.
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(ref Guid audioSessionGuid, int streamFlags, out IntPtr sessionControl);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid audioSessionGuid, int streamFlags, out IntPtr audioVolume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);
    [PreserveSig] int RegisterSessionNotification(IntPtr sessionNotification);
    [PreserveSig] int UnregisterSessionNotification(IntPtr sessionNotification);
    [PreserveSig] int RegisterDuckNotification(string sessionId, IntPtr duckNotification);
    [PreserveSig] int UnregisterDuckNotification(IntPtr duckNotification);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int sessionCount);
    [PreserveSig] int GetSession(int sessionIndex, out IAudioSessionControl2 session);
}

// IAudioSessionControl2 inherits IAudioSessionControl; all nine base methods
// must be declared first or the process ids land in the wrong slots.
[ComImport, Guid("BF448B81-5F84-4EB4-ABE7-8CBEA94F9C8A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(string name, ref Guid eventContext);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(string path, ref Guid eventContext);
    [PreserveSig] int GetGroupingParam(out Guid groupingParam);
    [PreserveSig] int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr notify);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notify);
    [PreserveSig] int GetSessionIdentifier(out IntPtr id);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
    [PreserveSig] int GetProcessId(out uint processId);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool preference);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public static class PhoneDeckVolume {
    public static void Set(float scalar) {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice device;
        int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device); // eRender, eMultimedia
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object obj;
        hr = device.Activate(ref iid, 1, IntPtr.Zero, out obj); // CLSCTX_INPROC_SERVER
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        var volume = (IAudioEndpointVolume)obj;
        Guid context = Guid.Empty;
        hr = volume.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, scalar)), ref context);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        if (Marshal.IsComObject(volume)) Marshal.ReleaseComObject(volume);
        if (Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
        if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
    }

    public static float GetScalar() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice device;
        int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device); // eRender, eMultimedia
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object obj;
        hr = device.Activate(ref iid, 1, IntPtr.Zero, out obj); // CLSCTX_INPROC_SERVER
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        var volume = (IAudioEndpointVolume)obj;
        float level;
        hr = volume.GetMasterVolumeLevelScalar(out level);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        if (Marshal.IsComObject(volume)) Marshal.ReleaseComObject(volume);
        if (Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
        if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
        return Math.Max(0f, Math.Min(1f, level));
    }
}

// Default capture endpoint (microphone). The scalar range is 0..1, not dB.
public static class PhoneDeckCapture {
    private static IAudioEndpointVolume OpenCapture(out IMMDevice device, out IMMDeviceEnumerator enumerator) {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        int hr = enumerator.GetDefaultAudioEndpoint(1, 1, out device); // eCapture, eMultimedia
        if (hr != 0) {
            if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
            Marshal.ThrowExceptionForHR(hr);
        }
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object obj;
        hr = device.Activate(ref iid, 1, IntPtr.Zero, out obj); // CLSCTX_INPROC_SERVER
        if (hr != 0) {
            if (Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
            if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
            Marshal.ThrowExceptionForHR(hr);
        }
        return (IAudioEndpointVolume)obj;
    }

    private static void Close(IAudioEndpointVolume volume, IMMDevice device, IMMDeviceEnumerator enumerator) {
        if (Marshal.IsComObject(volume)) Marshal.ReleaseComObject(volume);
        if (Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
        if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
    }

    public static void SetGain(float scalar) {
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var volume = OpenCapture(out device, out enumerator);
        try {
            Guid context = Guid.Empty;
            int hr = volume.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, scalar)), ref context);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        } finally {
            Close(volume, device, enumerator);
        }
    }

    public static void Get(out float level, out bool muted) {
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var volume = OpenCapture(out device, out enumerator);
        try {
            int hr = volume.GetMasterVolumeLevelScalar(out level);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            hr = volume.GetMute(out muted);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            level = Math.Max(0f, Math.Min(1f, level));
        } finally {
            Close(volume, device, enumerator);
        }
    }

    public static void SetMute(bool muted) {
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var volume = OpenCapture(out device, out enumerator);
        try {
            Guid context = Guid.Empty;
            int hr = volume.SetMute(muted, ref context);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        } finally {
            Close(volume, device, enumerator);
        }
    }

    public static void ToggleMute(out float level, out bool muted) {
        Get(out level, out muted);
        SetMute(!muted);
        muted = !muted;
    }
}

public class AudioSessionInfo {
    public string Id;
    public uint Pid;
    public string Process;
    public string Name;
    public double Volume;
    public bool Muted;
}

// Per-application render sessions (IAudioSessionManager2 / ISimpleAudioVolume).
public static class PhoneDeckSessions {
    private static string TakeString(IntPtr pointer) {
        if (pointer == IntPtr.Zero) return string.Empty;
        try { return Marshal.PtrToStringUni(pointer) ?? string.Empty; }
        finally { Marshal.FreeCoTaskMem(pointer); }
    }

    private static IMMDeviceEnumerator OpenEnumerator() {
        return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    }

    private static IAudioSessionManager2 OpenManager(out IMMDevice device, out IMMDeviceEnumerator enumerator) {
        enumerator = OpenEnumerator();
        int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device); // eRender, eMultimedia
        if (hr != 0) {
            if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
            Marshal.ThrowExceptionForHR(hr);
        }
        Guid iid = typeof(IAudioSessionManager2).GUID;
        object obj;
        hr = device.Activate(ref iid, 1, IntPtr.Zero, out obj); // CLSCTX_INPROC_SERVER
        if (hr != 0) {
            if (Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
            if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
            Marshal.ThrowExceptionForHR(hr);
        }
        return (IAudioSessionManager2)obj;
    }

    private static void CloseManager(IAudioSessionManager2 manager, IMMDevice device, IMMDeviceEnumerator enumerator) {
        if (manager != null && Marshal.IsComObject(manager)) Marshal.ReleaseComObject(manager);
        if (device != null && Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
        if (enumerator != null && Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
    }

    private static AudioSessionInfo ReadSession(IAudioSessionControl2 control, int index) {
        int state;
        if (control.GetState(out state) == 0 && state == 2) return null; // AudioSessionStateExpired
        if (control.IsSystemSoundsSession() == 0) return null;

        uint pid = 0;
        control.GetProcessId(out pid);

        string process = string.Empty;
        try {
            if (pid > 0) {
                process = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
            }
        } catch (Exception) { }

        IntPtr displayPointer;
        string display = control.GetDisplayName(out displayPointer) == 0 ? TakeString(displayPointer) : string.Empty;
        if (display.StartsWith("@")) display = string.Empty;

        IntPtr instancePointer;
        string id = control.GetSessionInstanceIdentifier(out instancePointer) == 0
            ? TakeString(instancePointer)
            : string.Empty;
        if (string.IsNullOrEmpty(id)) id = pid + ":" + index;
        if (string.IsNullOrEmpty(process)) process = display;

        float level = 1f;
        bool muted = false;
        var volume = control as ISimpleAudioVolume;
        if (volume != null) {
            if (volume.GetMasterVolume(out level) != 0) level = 1f;
            if (volume.GetMute(out muted) != 0) muted = false;
        }

        return new AudioSessionInfo {
            Id = id,
            Pid = pid,
            Process = process,
            Name = string.IsNullOrEmpty(display) ? process : display,
            Volume = Math.Max(0.0, Math.Min(1.0, level)),
            Muted = muted
        };
    }

    private static System.Collections.Generic.List<AudioSessionInfo> ReadAll() {
        var result = new System.Collections.Generic.List<AudioSessionInfo>();
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var manager = OpenManager(out device, out enumerator);
        IAudioSessionEnumerator sessions = null;
        try {
            int hr = manager.GetSessionEnumerator(out sessions);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            int count;
            hr = sessions.GetCount(out count);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            for (int index = 0; index < count; index++) {
                IAudioSessionControl2 control;
                hr = sessions.GetSession(index, out control);
                if (hr != 0 || control == null) continue;
                try {
                    var info = ReadSession(control, index);
                    if (info != null) result.Add(info);
                } finally {
                    if (Marshal.IsComObject(control)) Marshal.ReleaseComObject(control);
                }
            }
        } finally {
            if (sessions != null && Marshal.IsComObject(sessions)) Marshal.ReleaseComObject(sessions);
            CloseManager(manager, device, enumerator);
        }
        return result;
    }

    public static AudioSessionInfo[] List() {
        return ReadAll().ToArray();
    }

    private static void WithSession(string id, Action<ISimpleAudioVolume> action) {
        IMMDevice device;
        IMMDeviceEnumerator enumerator;
        var manager = OpenManager(out device, out enumerator);
        IAudioSessionEnumerator sessions = null;
        try {
            int hr = manager.GetSessionEnumerator(out sessions);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            int count;
            sessions.GetCount(out count);
            for (int index = 0; index < count; index++) {
                IAudioSessionControl2 control;
                hr = sessions.GetSession(index, out control);
                if (hr != 0 || control == null) continue;
                try {
                    IntPtr instancePointer;
                    string sessionId = control.GetSessionInstanceIdentifier(out instancePointer) == 0
                        ? TakeString(instancePointer)
                        : string.Empty;
                    if (string.IsNullOrEmpty(sessionId)) {
                        // Windows PowerShell 5.1 compiles Add-Type as C# 5, which
                        // does not allow the C# 7 inline `out uint pid` form.
                        uint pid;
                        sessionId = control.GetProcessId(out pid) == 0 ? pid + ":" + index : index.ToString();
                    }
                    if (!string.Equals(sessionId, id, StringComparison.Ordinal)) continue;
                    var volume = control as ISimpleAudioVolume;
                    if (volume == null) throw new InvalidOperationException("Audio session has no volume control: " + id);
                    action(volume);
                    return;
                } finally {
                    if (Marshal.IsComObject(control)) Marshal.ReleaseComObject(control);
                }
            }
            throw new InvalidOperationException("Audio session not found: " + id);
        } finally {
            if (sessions != null && Marshal.IsComObject(sessions)) Marshal.ReleaseComObject(sessions);
            CloseManager(manager, device, enumerator);
        }
    }

    public static void SetVolume(string id, float scalar) {
        WithSession(id, delegate(ISimpleAudioVolume volume) {
            Guid context = Guid.Empty;
            int hr = volume.SetMasterVolume(Math.Max(0f, Math.Min(1f, scalar)), ref context);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        });
    }

    public static void SetMute(string id, bool muted) {
        WithSession(id, delegate(ISimpleAudioVolume volume) {
            Guid context = Guid.Empty;
            int hr = volume.SetMute(muted, ref context);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        });
    }
}
'@

$SCRIPT:VK = @{
    'CTRL' = 0x11; 'ALT' = 0x12; 'SHIFT' = 0x10; 'WIN' = 0x5B
    'ENTER' = 0x0D; 'TAB' = 0x09; 'ESC' = 0x1B; 'SPACE' = 0x20
    'BACKSPACE' = 0x08; 'DELETE' = 0x2E; 'INSERT' = 0x2D
    'HOME' = 0x24; 'END' = 0x23; 'PGUP' = 0x21; 'PGDN' = 0x22
    'UP' = 0x26; 'DOWN' = 0x28; 'LEFT' = 0x25; 'RIGHT' = 0x27
    'PRINTSCREEN' = 0x2C; 'CAPSLOCK' = 0x14; 'NUMLOCK' = 0x90
    'SCROLLLOCK' = 0x91; 'PAUSE' = 0x13; 'MENU' = 0x5D
    ';' = 0xBA; '=' = 0xBB; ',' = 0xBC; '-' = 0xBD; '.' = 0xBE; '/' = 0xBF
    '`' = 0xC0; '[' = 0xDB; '\' = 0xDC; ']' = 0xDD; "'" = 0xDE
    '+' = 0xBB; '*' = 0x6A
    'NUMPAD0' = 0x60; 'NUMPAD1' = 0x61; 'NUMPAD2' = 0x62; 'NUMPAD3' = 0x63
    'NUMPAD4' = 0x64; 'NUMPAD5' = 0x65; 'NUMPAD6' = 0x66; 'NUMPAD7' = 0x67
    'NUMPAD8' = 0x68; 'NUMPAD9' = 0x69
    'MEDIA_PLAYPAUSE' = 0xB3; 'MEDIA_NEXT' = 0xB0; 'MEDIA_PREV' = 0xB1; 'MEDIA_STOP' = 0xB2
    'VOLUME_MUTE' = 0xAD; 'VOLUME_DOWN' = 0xAE; 'VOLUME_UP' = 0xAF
}

function Get-VkCode([string]$Name) {
    $upper = $Name.ToUpperInvariant()
    if ($SCRIPT:VK.ContainsKey($upper)) { return [byte]$SCRIPT:VK[$upper] }
    if ($upper.Length -eq 1) {
        $code = [int][char]$upper
        if (($code -ge 65 -and $code -le 90) -or ($code -ge 48 -and $code -le 57)) { return [byte]$code }
    }
    if ($upper -match '^F([1-9]|1[0-9]|2[0-4])$') {
        $number = [int]$upper.Substring(1)
        return [byte](0x6F + $number)
    }
    throw "Unknown key: $Name"
}

$SCRIPT:HeldCodes = New-Object System.Collections.ArrayList

function Release-HeldKeys {
    if ($null -eq $SCRIPT:HeldCodes -or $SCRIPT:HeldCodes.Count -eq 0) { return }
    for ($i = $SCRIPT:HeldCodes.Count - 1; $i -ge 0; $i--) {
        try {
            [PhoneDeckNative]::keybd_event([byte]$SCRIPT:HeldCodes[$i], 0, 2, [UIntPtr]::Zero)
        } catch {
            # Best effort: keep releasing the remaining keys.
        }
    }
    $SCRIPT:HeldCodes.Clear()
}

function Send-Chord([string[]]$Keys, [int]$HoldMs, [string]$Action = 'press') {
    $codes = @()
    foreach ($key in $Keys) { $codes += Get-VkCode $key }
    $mode = if ($Action) { $Action.ToLowerInvariant() } else { 'press' }

    if ($mode -eq 'down') {
        foreach ($code in $codes) {
            [PhoneDeckNative]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero)
            if (-not $SCRIPT:HeldCodes.Contains([int]$code)) {
                [void]$SCRIPT:HeldCodes.Add([int]$code)
            }
        }
        return
    }

    if ($mode -eq 'up') {
        $reversed = $codes.Clone()
        [array]::Reverse($reversed)
        foreach ($code in $reversed) {
            [PhoneDeckNative]::keybd_event([byte]$code, 0, 2, [UIntPtr]::Zero)
            [void]$SCRIPT:HeldCodes.Remove([int]$code)
        }
        return
    }

    if ($mode -ne 'press') { throw "Unknown key action: $Action" }

    try {
        foreach ($code in $codes) {
            [PhoneDeckNative]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero)
        }
        Start-Sleep -Milliseconds ([Math]::Max(15, [Math]::Min(5000, $HoldMs)))
    } finally {
        $reversed = $codes.Clone()
        [array]::Reverse($reversed)
        foreach ($code in $reversed) {
            [PhoneDeckNative]::keybd_event([byte]$code, 0, 2, [UIntPtr]::Zero)
        }
    }
}

function Send-Text([string]$Text, [int]$PerCharMs) {
    $delay = [Math]::Max(0, [Math]::Min(1000, $PerCharMs))
    for ($i = 0; $i -lt $Text.Length; $i++) {
        $char = $Text[$i]
        if ($char -eq "`r") { continue }
        if ($char -eq "`n") { Send-Chord @('ENTER') 25; continue }
        if ($char -eq "`t") { Send-Chord @('TAB') 25; continue }
        [PhoneDeckNative]::UnicodeChar([System.UInt16][int]$char)
        if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
    }
}

function Send-Mouse([string]$Button, [string]$Action, $X, $Y, [string]$Direction, $Amount) {
    $mode = $Action.ToLowerInvariant()
    if ($mode -eq 'move') {
        if ($null -eq $X -or $null -eq $Y) { throw "Mouse move needs X and Y coordinates" }
        [void][PhoneDeckNative]::SetCursorPos([int]$X, [int]$Y)
        return
    }
    if ($mode -eq 'scroll') {
        $notches = [Math]::Max(1, [Math]::Min(100, [int]$Amount))
        $delta = 120 * $notches
        $dir = if ($Direction) { $Direction.ToLowerInvariant() } else { 'down' }
        if ($dir -eq 'down' -or $dir -eq 'left') { $delta = -$delta }
        $flag = if ($dir -eq 'left' -or $dir -eq 'right') { 0x01000 } else { 0x0800 }
        $wheel = if ($delta -lt 0) { [System.UInt32]([System.Int64]$delta + 4294967296) } else { [System.UInt32]$delta }
        [PhoneDeckNative]::mouse_event([System.UInt32]$flag, 0, 0, $wheel, [UIntPtr]::Zero)
        return
    }

    if ($null -ne $X -and $null -ne $Y) {
        [void][PhoneDeckNative]::SetCursorPos([int]$X, [int]$Y)
    }
    $down = @{ 'left' = 0x0002; 'right' = 0x0008; 'middle' = 0x0020 }
    $up = @{ 'left' = 0x0004; 'right' = 0x0010; 'middle' = 0x0040 }
    $buttonKey = $Button.ToLowerInvariant()
    if (-not $down.ContainsKey($buttonKey)) { throw "Unknown mouse button: $Button" }
    switch ($mode) {
        'click' {
            [PhoneDeckNative]::mouse_event($down[$buttonKey], 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 20
            [PhoneDeckNative]::mouse_event($up[$buttonKey], 0, 0, 0, [UIntPtr]::Zero)
        }
        'doubleclick' {
            [PhoneDeckNative]::mouse_event($down[$buttonKey], 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 20
            [PhoneDeckNative]::mouse_event($up[$buttonKey], 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 50
            [PhoneDeckNative]::mouse_event($down[$buttonKey], 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 20
            [PhoneDeckNative]::mouse_event($up[$buttonKey], 0, 0, 0, [UIntPtr]::Zero)
        }
        'down' { [PhoneDeckNative]::mouse_event($down[$buttonKey], 0, 0, 0, [UIntPtr]::Zero) }
        'up' { [PhoneDeckNative]::mouse_event($up[$buttonKey], 0, 0, 0, [UIntPtr]::Zero) }
        default { throw "Unknown mouse action: $Action" }
    }
}

function Send-Pointer($Step) {
    $point = [PhoneDeckNative+POINT]::new()
    if (-not [PhoneDeckNative]::GetCursorPos([ref]$point)) {
        throw 'Could not read the cursor position'
    }

    $dx = if ($null -ne $Step.dx) { [double]$Step.dx } else { 0.0 }
    $dy = if ($null -ne $Step.dy) { [double]$Step.dy } else { 0.0 }
    $height = [PhoneDeckNative]::MonitorHeightAt($point.X, $point.Y)
    $targetX = [int][Math]::Round($point.X + $dx * $height)
    $targetY = [int][Math]::Round($point.Y + $dy * $height)

    # GetSystemMetrics 76..79 = virtual screen X, Y, width, height. A
    # per-monitor-aware process sees physical pixels, so this clamp is exact.
    $left = [PhoneDeckNative]::GetSystemMetrics(76)
    $top = [PhoneDeckNative]::GetSystemMetrics(77)
    $width = [PhoneDeckNative]::GetSystemMetrics(78)
    $screenHeight = [PhoneDeckNative]::GetSystemMetrics(79)
    if ($width -gt 0 -and $screenHeight -gt 0) {
        $targetX = [Math]::Max($left, [Math]::Min($left + $width - 1, $targetX))
        $targetY = [Math]::Max($top, [Math]::Min($top + $screenHeight - 1, $targetY))
    }
    [void][PhoneDeckNative]::SetCursorPos($targetX, $targetY)

    # Some environments (UIPI, remote sessions, certain DPI setups) accept
    # SetCursorPos but leave the cursor in place. Verify once and fall back to
    # relative mouse_event movement so a frame is never silently lost.
    if ($targetX -ne $point.X -or $targetY -ne $point.Y) {
        $verify = [PhoneDeckNative+POINT]::new()
        $moved = [PhoneDeckNative]::GetCursorPos([ref]$verify) -and
            [Math]::Abs($verify.X - $targetX) -le 1 -and
            [Math]::Abs($verify.Y - $targetY) -le 1
        if (-not $moved) {
            $relX = [int]($targetX - $point.X)
            $relY = [int]($targetY - $point.Y)
            $mouseDx = if ($relX -lt 0) { [System.UInt32]([System.Int64]$relX + 4294967296) } else { [System.UInt32]$relX }
            $mouseDy = if ($relY -lt 0) { [System.UInt32]([System.Int64]$relY + 4294967296) } else { [System.UInt32]$relY }
            [PhoneDeckNative]::mouse_event([System.UInt32]0x0001, $mouseDx, $mouseDy, [System.UInt32]0, [UIntPtr]::Zero)
        }
    }

    if ($null -ne $Step.scrollY) {
        $delta = [int][Math]::Round(([double]$Step.scrollY) * 120.0)
        $delta = [Math]::Max(-12000, [Math]::Min(12000, $delta))
        if ($delta -ne 0) {
            $wheel = if ($delta -lt 0) { [System.UInt32]([System.Int64]$delta + 4294967296) } else { [System.UInt32]$delta }
            [PhoneDeckNative]::mouse_event([System.UInt32]0x0800, 0, 0, $wheel, [UIntPtr]::Zero)
        }
    }
    if ($null -ne $Step.scrollX) {
        $delta = [int][Math]::Round(([double]$Step.scrollX) * 120.0)
        $delta = [Math]::Max(-12000, [Math]::Min(12000, $delta))
        if ($delta -ne 0) {
            $wheel = if ($delta -lt 0) { [System.UInt32]([System.Int64]$delta + 4294967296) } else { [System.UInt32]$delta }
            [PhoneDeckNative]::mouse_event([System.UInt32]0x01000, 0, 0, $wheel, [UIntPtr]::Zero)
        }
    }

    if ($null -ne $Step.buttons) {
        foreach ($buttonEvent in $Step.buttons) {
            Send-Mouse ([string]$buttonEvent.button) ([string]$buttonEvent.action) $null $null $null $null
        }
    }
}

function Set-SystemVolume([int]$Level) {
    $clamped = [Math]::Max(0, [Math]::Min(100, $Level))
    [PhoneDeckVolume]::Set([single]($clamped / 100.0))
}

function Get-SystemVolume {
    return @{ value = [double][PhoneDeckVolume]::GetScalar() }
}

function Set-InputGain([int]$Level) {
    $clamped = [Math]::Max(0, [Math]::Min(100, $Level))
    [PhoneDeckCapture]::SetGain([single]($clamped / 100.0))
}

function Get-InputState {
    $level = [single]0
    $muted = $false
    [PhoneDeckCapture]::Get([ref]$level, [ref]$muted)
    return @{ value = [double]$level; muted = [bool]$muted }
}

function Set-InputMute([bool]$Muted) {
    [PhoneDeckCapture]::SetMute($Muted)
}

function Toggle-InputMute {
    $level = [single]0
    $muted = $false
    [PhoneDeckCapture]::ToggleMute([ref]$level, [ref]$muted)
    return @{ value = [double]$level; muted = [bool]$muted }
}

function Get-AudioSessions {
    $list = @()
    foreach ($session in [PhoneDeckSessions]::List()) {
        $list += @{
            id = [string]$session.Id
            process = [string]$session.Process
            name = [string]$session.Name
            volume = [double]$session.Volume
            muted = [bool]$session.Muted
        }
    }
    return @{ sessions = $list }
}

function Set-AppSessionVolume([string]$Id, [int]$Level) {
    $clamped = [Math]::Max(0, [Math]::Min(100, $Level))
    [PhoneDeckSessions]::SetVolume($Id, [single]($clamped / 100.0))
}

function Set-AppSessionMute([string]$Id, [bool]$Muted) {
    [PhoneDeckSessions]::SetMute($Id, $Muted)
}

function Invoke-Step($Step) {
    switch ($Step.kind) {
        'set-volume' { Set-SystemVolume ([int]$Step.level) }
        'get-volume' { return Get-SystemVolume }
        'set-input-gain' { Set-InputGain ([int]$Step.level) }
        'get-input' { return Get-InputState }
        'set-input-mute' { Set-InputMute ([bool]$Step.muted) }
        'toggle-input-mute' { return Toggle-InputMute }
        'list-audio-sessions' { return Get-AudioSessions }
        'set-app-volume' { Set-AppSessionVolume ([string]$Step.id) ([int]$Step.level) }
        'set-app-mute' { Set-AppSessionMute ([string]$Step.id) ([bool]$Step.muted) }
        'keys' { Send-Chord $Step.keys ([int]$Step.holdMs) ([string]$Step.action) }
        'text' { Send-Text ([string]$Step.text) ([int]$Step.perCharMs) }
        'delay' { Start-Sleep -Milliseconds ([Math]::Max(0, [Math]::Min(60000, [int]$Step.ms))) }
        'media' {
            $map = @{
                'playpause' = 'MEDIA_PLAYPAUSE'; 'next' = 'MEDIA_NEXT'; 'prev' = 'MEDIA_PREV'
                'stop' = 'MEDIA_STOP'; 'volumeup' = 'VOLUME_UP'; 'volumedown' = 'VOLUME_DOWN'; 'mute' = 'VOLUME_MUTE'
            }
            $key = $map[([string]$Step.key).ToLowerInvariant()]
            if (-not $key) { throw "Unknown media key: $($Step.key)" }
            Send-Chord @($key) 30
        }
        'mouse' { Send-Mouse ([string]$Step.button) ([string]$Step.action) $Step.x $Step.y ([string]$Step.direction) $Step.amount }
        'pointer' { Send-Pointer $Step }
        default { throw "Unknown step kind: $($Step.kind)" }
    }
}

[PhoneDeckNative]::EnableDpiAwareness()
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

try {
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $id = ''
        try {
            $command = $line | ConvertFrom-Json
            $id = [string]$command.id
            $stepData = $null
            foreach ($step in $command.steps) {
                $result = Invoke-Step $step
                if ($null -ne $result) { $stepData = $result }
            }
            $response = @{ id = $id; ok = $true }
            if ($stepData -is [hashtable]) {
                foreach ($key in $stepData.Keys) { $response[$key] = $stepData[$key] }
            }
            $response = $response | ConvertTo-Json -Compress -Depth 6
        } catch {
            $message = $_.Exception.Message
            if (-not $message) { $message = 'Unknown keyboard helper error' }
            $response = @{ id = $id; ok = $false; error = $message } | ConvertTo-Json -Compress
        }
        [Console]::Out.WriteLine($response)
        [Console]::Out.Flush()
    }
} finally {
    # EOF or a process-level failure: never leave a held shortcut key down.
    Release-HeldKeys
}
