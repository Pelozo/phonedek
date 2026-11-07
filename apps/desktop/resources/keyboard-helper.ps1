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

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

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

function Send-Chord([string[]]$Keys, [int]$HoldMs) {
    $codes = @()
    foreach ($key in $Keys) { $codes += Get-VkCode $key }
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

function Set-SystemVolume([int]$Level) {
    $clamped = [Math]::Max(0, [Math]::Min(100, $Level))
    [PhoneDeckVolume]::Set([single]($clamped / 100.0))
}

function Invoke-Step($Step) {
    switch ($Step.kind) {
        'set-volume' { Set-SystemVolume ([int]$Step.level) }
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
        default { throw "Unknown step kind: $($Step.kind)" }
    }
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $id = ''
    try {
        $command = $line | ConvertFrom-Json
        $id = [string]$command.id
        foreach ($step in $command.steps) { Invoke-Step $step }
        $response = @{ id = $id; ok = $true } | ConvertTo-Json -Compress
    } catch {
        $message = $_.Exception.Message
        if (-not $message) { $message = 'Unknown keyboard helper error' }
        $response = @{ id = $id; ok = $false; error = $message } | ConvertTo-Json -Compress
    }
    [Console]::Out.WriteLine($response)
    [Console]::Out.Flush()
}
