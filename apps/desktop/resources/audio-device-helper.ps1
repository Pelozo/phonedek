# PhoneDeck Windows default-audio-device helper.
#
# One-shot use (exactly one JSON object on stdout, errors exit non-zero):
#   powershell -File audio-device-helper.ps1 list
#   powershell -File audio-device-helper.ps1 default --kind output
#   powershell -File audio-device-helper.ps1 set --id <opaque> --kind output [--all-roles 0|1]
#   powershell -File audio-device-helper.ps1 selftest
#
# Persistent use (--jsonl): writes {"ready":true} once, then reads one JSON
# request per line and writes one JSON response per line:
#   {"id":"1","command":"list"}
#   {"id":"2","command":"default","kind":"output"}
#   {"id":"3","command":"set","kind":"input","deviceId":"...","allRoles":true}
#   {"id":"4","command":"selftest"}
#
# Windows PowerShell 5.1 compiles Add-Type as C# 5: no inline `out var`, no
# string interpolation, no expression-bodied members. The same source is used
# by Windows PowerShell 5.1 and PowerShell 7.
#
# Enumeration uses the documented Core Audio endpoint APIs. Setting the default
# is not a documented Win32 API; this helper uses the same undocumented
# IPolicyConfig interfaces as Windows itself and other audio switchers. The
# classic Windows 7 / Windows 10 RS1+ interface is tried first, then the
# Windows 10 TH1/TH2 IIDs, then the Vista client. A clear error is returned if
# none works. Raw endpoint paths never leave this process: every id that is
# printed is a SHA-256 hash prefix of the endpoint id.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Limit-Text([string]$Text, [int]$Max) {
    if ($null -eq $Text) { return '' }
    $clean = [regex]::Replace($Text, '[\u0000-\u001F\u007F]', ' ')
    $clean = [regex]::Replace($clean, '\s+', ' ').Trim()
    if ($clean.Length -gt $Max) { $clean = $clean.Substring(0, $Max) }
    return $clean
}

function Write-Json($Value) {
    $json = $Value | ConvertTo-Json -Compress -Depth 8
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Write-Failure([string]$Message, [string]$Id = '') {
    $body = @{ ok = $false; error = (Limit-Text $Message 300) }
    if ($Id) { $body.id = $Id }
    Write-Json $body
}

try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
        [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId(out IntPtr id);
    [PreserveSig] int GetState(out int state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int Commit();
}

[StructLayout(LayoutKind.Sequential)]
internal struct PROPERTYKEY {
    public Guid fmtid;
    public int pid;
}

// PROPVARIANT is 24 bytes on x64 (2 byte vt + 6 reserved + a 16 byte union).
// Explicit Size keeps the marshaller from writing past a shorter struct.
[StructLayout(LayoutKind.Explicit, Size = 24)]
internal struct PROPVARIANT {
    [FieldOffset(0)] public short vt;
    [FieldOffset(8)] public IntPtr pointerValue;
}

[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
internal class PolicyConfigClient { }

[ComImport, Guid("294935CE-F637-4E7C-A41B-AB255460B862")]
internal class PolicyConfigVistaClient { }

// Windows 7 / Windows 8 / Windows 10 RS1+ (still the one present today).
[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultFormat, out IntPtr format);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultPeriod, out long defaultPeriodValue,
        out long minimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool visible);
}

// Windows 10 TH1. Same vtable, different IID.
[ComImport, Guid("CA286FC3-91FD-42C3-8E9B-CAAFA66242E3"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig10 {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultFormat, out IntPtr format);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultPeriod, out long defaultPeriodValue,
        out long minimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool visible);
}

// Windows 10 TH2. Same vtable, different IID.
[ComImport, Guid("6BE54BE8-A068-4875-A49D-0C2966473B11"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig10_1 {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultFormat, out IntPtr format);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultPeriod, out long defaultPeriodValue,
        out long minimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool visible);
}

// Vista / Windows 7. The vtable has no ResetDeviceFormat.
[ComImport, Guid("568B9108-44BF-40B4-9006-86AFE5B5A620"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfigVista {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultFormat, out IntPtr format);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id,
        IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool defaultPeriod, out long defaultPeriodValue,
        out long minimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id,
        ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id,
        [MarshalAs(UnmanagedType.Bool)] bool visible);
}

public class AudioEndpointInfo {
    public string Id;
    public string Name;
    public string Kind;
    public string Form;
    public bool Current;
    public string RawId;
}

public static class PhoneDeckAudioDevices {
    private const int DEVICE_STATE_ACTIVE = 0x1;
    private const int STGM_READ = 0x0;
    private const int VT_LPWSTR = 31;
    private const int VT_BSTR = 8;

    private static readonly Guid PKEY_Device_FriendlyName =
        new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
    private static readonly Guid PKEY_DeviceInterface_FriendlyName =
        new Guid("b3f8fa53-0004-438e-9003-51a46e139bfc");

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT value);

    private delegate int SetDefaultDelegate(
        [MarshalAs(UnmanagedType.LPWStr)] string id, int role);

    private static void Release(object value) {
        if (value != null && Marshal.IsComObject(value)) {
            try { Marshal.ReleaseComObject(value); } catch (Exception) { }
        }
    }

    private static string ReadString(IPropertyStore store, Guid fmtid, int pid) {
        PROPERTYKEY key = new PROPERTYKEY();
        key.fmtid = fmtid;
        key.pid = pid;
        PROPVARIANT value;
        int hr = store.GetValue(ref key, out value);
        if (hr != 0) return null;
        try {
            if (value.vt == VT_LPWSTR && value.pointerValue != IntPtr.Zero) {
                return Marshal.PtrToStringUni(value.pointerValue);
            }
            if (value.vt == VT_BSTR && value.pointerValue != IntPtr.Zero) {
                return Marshal.PtrToStringBSTR(value.pointerValue);
            }
            return null;
        } finally {
            PropVariantClear(ref value);
        }
    }

    private static string ReadDeviceId(IMMDevice device) {
        IntPtr pointer;
        int hr = device.GetId(out pointer);
        if (hr != 0 || pointer == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringUni(pointer); }
        finally { Marshal.FreeCoTaskMem(pointer); }
    }

    public static string HashId(string rawId) {
        if (rawId == null) return string.Empty;
        using (SHA256 sha = SHA256.Create()) {
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(rawId));
            StringBuilder builder = new StringBuilder(16);
            for (int index = 0; index < 8; index++) {
                builder.Append(hash[index].ToString("x2"));
            }
            return builder.ToString();
        }
    }

    private static bool ContainsAny(string text, string[] needles) {
        for (int index = 0; index < needles.Length; index++) {
            if (text.IndexOf(needles[index], StringComparison.Ordinal) >= 0) return true;
        }
        return false;
    }

    private static string DetectForm(string name, string enumeratorName, int dataFlow) {
        string lower = (name ?? string.Empty).ToLowerInvariant();
        string enumerator = (enumeratorName ?? string.Empty).ToUpperInvariant();

        if (ContainsAny(lower, new string[] {
            "vb-audio", "voicemeeter", "virtual", "cable", "loopback",
            "steam streaming", "nvidia broadcast", "wave link", "obs virtual"
        })) return "virtual";
        if (enumerator.StartsWith("BTH", StringComparison.Ordinal) ||
            lower.IndexOf("bluetooth", StringComparison.Ordinal) >= 0) return "bluetooth";
        if (enumerator == "USB" || lower.IndexOf("usb", StringComparison.Ordinal) >= 0) return "usb";
        if (ContainsAny(lower, new string[] { "hdmi", "displayport", "display port" })) return "hdmi";
        if (lower.IndexOf("headset", StringComparison.Ordinal) >= 0) return "headset";
        if (lower.IndexOf("headphone", StringComparison.Ordinal) >= 0) return "headphones";
        if (dataFlow == 1) return "microphone";
        if (lower.IndexOf("speaker", StringComparison.Ordinal) >= 0) return "speakers";
        return "other";
    }

    private static AudioEndpointInfo ReadDevice(IMMDevice device, int dataFlow, bool current) {
        string rawId = ReadDeviceId(device);
        if (string.IsNullOrEmpty(rawId)) return null;

        string friendly = null;
        string interfaceName = null;
        string description = null;
        string enumeratorName = null;
        IPropertyStore store = null;
        int hr = device.OpenPropertyStore(STGM_READ, out store);
        if (hr == 0 && store != null) {
            try {
                friendly = ReadString(store, PKEY_Device_FriendlyName, 14);
                interfaceName = ReadString(store, PKEY_DeviceInterface_FriendlyName, 6);
                description = ReadString(store, PKEY_Device_FriendlyName, 2);
                enumeratorName = ReadString(store, PKEY_Device_FriendlyName, 24);
            } finally {
                Release(store);
            }
        }

        string name = friendly;
        if (string.IsNullOrWhiteSpace(name)) name = interfaceName;
        if (string.IsNullOrWhiteSpace(name)) name = description;
        if (string.IsNullOrWhiteSpace(name)) name = "Unknown audio device";
        name = name.Trim();

        AudioEndpointInfo info = new AudioEndpointInfo();
        info.Id = HashId(rawId);
        info.RawId = rawId;
        info.Name = name;
        info.Kind = dataFlow == 1 ? "input" : "output";
        info.Form = DetectForm(name, enumeratorName, dataFlow);
        info.Current = current;
        return info;
    }

    private static AudioEndpointInfo[] ReadAll(int dataFlow) {
        System.Collections.Generic.List<AudioEndpointInfo> result =
            new System.Collections.Generic.List<AudioEndpointInfo>();
        IMMDeviceEnumerator enumerator = null;
        IMMDeviceCollection collection = null;
        try {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            int hr = enumerator.EnumAudioEndpoints(dataFlow, DEVICE_STATE_ACTIVE, out collection);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            if (collection == null) return result.ToArray();

            int count;
            hr = collection.GetCount(out count);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            for (int index = 0; index < count; index++) {
                IMMDevice device = null;
                hr = collection.Item(index, out device);
                if (hr != 0 || device == null) continue;
                try {
                    AudioEndpointInfo info = ReadDevice(device, dataFlow, false);
                    if (info != null) result.Add(info);
                } catch (Exception) {
                    // One broken endpoint must not hide the rest of the list.
                } finally {
                    Release(device);
                }
            }
            return result.ToArray();
        } finally {
            Release(collection);
            Release(enumerator);
        }
    }

    public static AudioEndpointInfo[] List(int dataFlow) {
        return ReadAll(dataFlow);
    }

    public static AudioEndpointInfo GetDefault(int dataFlow) {
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        try {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            int hr = enumerator.GetDefaultAudioEndpoint(dataFlow, 1, out device); // eMultimedia
            if (hr != 0 || device == null) return null;
            return ReadDevice(device, dataFlow, true);
        } finally {
            Release(device);
            Release(enumerator);
        }
    }

    public static string FindRawId(int dataFlow, string opaqueId) {
        if (string.IsNullOrEmpty(opaqueId)) return null;
        AudioEndpointInfo[] devices = ReadAll(dataFlow);
        for (int index = 0; index < devices.Length; index++) {
            if (string.Equals(devices[index].Id, opaqueId, StringComparison.OrdinalIgnoreCase)) {
                return devices[index].RawId;
            }
        }
        return null;
    }

    private static void ApplyRoles(SetDefaultDelegate setter, string rawId, bool allRoles) {
        int[] roles = allRoles ? new int[] { 0, 1, 2 } : new int[] { 1 };
        for (int index = 0; index < roles.Length; index++) {
            int hr = setter(rawId, roles[index]);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        }
    }

    private static string TryClassic(string rawId, bool allRoles) {
        object client = null;
        try {
            client = new PolicyConfigClient();
            IPolicyConfig policy = (IPolicyConfig)client;
            ApplyRoles(new SetDefaultDelegate(policy.SetDefaultEndpoint), rawId, allRoles);
            return "IPolicyConfig";
        } finally {
            Release(client);
        }
    }

    private static string TryWindows10(string rawId, bool allRoles) {
        object client = null;
        try {
            client = new PolicyConfigClient();
            try {
                IPolicyConfig10 policy = (IPolicyConfig10)client;
                ApplyRoles(new SetDefaultDelegate(policy.SetDefaultEndpoint), rawId, allRoles);
                return "IPolicyConfig10";
            } catch (InvalidCastException) {
                IPolicyConfig10_1 policy = (IPolicyConfig10_1)client;
                ApplyRoles(new SetDefaultDelegate(policy.SetDefaultEndpoint), rawId, allRoles);
                return "IPolicyConfig10_1";
            }
        } finally {
            Release(client);
        }
    }

    private static string TryVista(string rawId, bool allRoles) {
        object client = null;
        try {
            client = new PolicyConfigVistaClient();
            IPolicyConfigVista policy = (IPolicyConfigVista)client;
            ApplyRoles(new SetDefaultDelegate(policy.SetDefaultEndpoint), rawId, allRoles);
            return "IPolicyConfigVista";
        } finally {
            Release(client);
        }
    }

    public static string SetDefault(string rawId, bool allRoles) {
        if (string.IsNullOrEmpty(rawId)) {
            throw new InvalidOperationException("No audio endpoint id was supplied.");
        }
        string lastError = null;

        try { return TryClassic(rawId, allRoles); }
        catch (Exception error) { lastError = error.Message; }
        try { return TryWindows10(rawId, allRoles); }
        catch (Exception error) { lastError = error.Message; }
        try { return TryVista(rawId, allRoles); }
        catch (Exception error) { lastError = error.Message; }

        throw new InvalidOperationException(
            "Windows rejected the default audio device change (the IPolicyConfig " +
            "interfaces are unavailable on this build). " + (lastError ?? string.Empty));
    }
}
'@
} catch {
    Write-Failure ("Could not compile the Core Audio helper: " + $_.Exception.Message)
    exit 1
}

$script:ArgList = @($args)

function Get-Option([string]$Name) {
    for ($index = 0; $index -lt $script:ArgList.Count; $index++) {
        $value = [string]$script:ArgList[$index]
        if ($value -eq "--$Name") {
            if ($index + 1 -lt $script:ArgList.Count) { return [string]$script:ArgList[$index + 1] }
        }
        if ($value -like "--$Name=*") {
            return $value.Substring($Name.Length + 3)
        }
    }
    return $null
}

function Convert-TextBool($Value, [bool]$Default) {
    if ($null -eq $Value) { return $Default }
    $text = ([string]$Value).ToLowerInvariant()
    if ($text -eq '0' -or $text -eq 'false' -or $text -eq 'no') { return $false }
    if ($text -eq '1' -or $text -eq 'true' -or $text -eq 'yes') { return $true }
    return $Default
}

function Get-Flow([string]$Kind) {
    if ($Kind -eq 'output') { return 0 }
    if ($Kind -eq 'input') { return 1 }
    throw "Unknown device kind: $Kind"
}

function Select-Endpoint($Endpoint) {
    $name = Limit-Text ([string]$Endpoint.Name) 120
    if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Unknown audio device' }
    return @{
        id = [string]$Endpoint.Id
        name = $name
        kind = [string]$Endpoint.Kind
        form = [string]$Endpoint.Form
        current = [bool]$Endpoint.Current
        available = $true
    }
}

function Set-CurrentFlag($Entries, $Current) {
    if ($null -eq $Current) { return }
    $currentId = [string]$Current.Id
    foreach ($entry in $Entries) {
        if ([string]$entry.id -eq $currentId) { $entry.current = $true }
    }
}

function Get-ListSnapshot {
    $output = @()
    foreach ($endpoint in [PhoneDeckAudioDevices]::List(0)) {
        $output += Select-Endpoint $endpoint
    }
    $input = @()
    foreach ($endpoint in [PhoneDeckAudioDevices]::List(1)) {
        $input += Select-Endpoint $endpoint
    }
    $snapshot = @{ output = $output; input = $input }

    $currentOutput = [PhoneDeckAudioDevices]::GetDefault(0)
    if ($null -ne $currentOutput) {
        $snapshot.currentOutputId = [string]$currentOutput.Id
        Set-CurrentFlag $output $currentOutput
    }
    $currentInput = [PhoneDeckAudioDevices]::GetDefault(1)
    if ($null -ne $currentInput) {
        $snapshot.currentInputId = [string]$currentInput.Id
        Set-CurrentFlag $input $currentInput
    }
    return $snapshot
}

function Get-DefaultSnapshot([string]$Kind) {
    if ([string]::IsNullOrWhiteSpace($Kind)) {
        $snapshot = @{}
        $output = [PhoneDeckAudioDevices]::GetDefault(0)
        if ($null -ne $output) {
            $snapshot.output = Select-Endpoint $output
            $snapshot.currentOutputId = [string]$output.Id
        }
        $input = [PhoneDeckAudioDevices]::GetDefault(1)
        if ($null -ne $input) {
            $snapshot.input = Select-Endpoint $input
            $snapshot.currentInputId = [string]$input.Id
        }
        return $snapshot
    }

    $flow = Get-Flow $Kind
    $endpoint = [PhoneDeckAudioDevices]::GetDefault($flow)
    if ($null -eq $endpoint) { throw "No default $Kind device is active." }
    return @{ kind = $Kind; device = (Select-Endpoint $endpoint) }
}

function Set-Device([string]$Kind, [string]$DeviceId, [bool]$AllRoles) {
    $flow = Get-Flow $Kind
    if ([string]::IsNullOrWhiteSpace($DeviceId)) { throw 'A device id is required.' }
    if ($DeviceId -notmatch '^[a-f0-9]{8,64}$') { throw 'The device id is not a valid opaque host key.' }

    $rawId = [PhoneDeckAudioDevices]::FindRawId($flow, $DeviceId)
    if ([string]::IsNullOrEmpty($rawId)) { throw "Device not found: $DeviceId" }

    $variant = [PhoneDeckAudioDevices]::SetDefault($rawId, $AllRoles)

    # Setting the default is asynchronous inside AudioSrv on some endpoints
    # (notably Bluetooth). Allow up to ~1 s before reporting a failure.
    $applied = $null
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        $candidate = [PhoneDeckAudioDevices]::GetDefault($flow)
        if ($null -ne $candidate -and [string]$candidate.Id -eq $DeviceId) {
            $applied = $candidate
            break
        }
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $applied) {
        throw "Windows did not switch the default $Kind device."
    }

    return @{ kind = $Kind; variant = $variant; device = (Select-Endpoint $applied) }
}

function Invoke-SelfTest {
    $output = @()
    $input = @()
    $enumerated = $true
    $warning = $null
    try {
        foreach ($endpoint in [PhoneDeckAudioDevices]::List(0)) {
            $output += Select-Endpoint $endpoint
        }
        foreach ($endpoint in [PhoneDeckAudioDevices]::List(1)) {
            $input += Select-Endpoint $endpoint
        }
    } catch {
        $enumerated = $false
        $warning = Limit-Text $_.Exception.Message 200
    }

    $result = @{ selftest = $true; enumerated = $enumerated; output = $output; input = $input }
    if ($warning) { $result.warning = $warning }
    return $result
}

function Invoke-AudioCommand([string]$Command, $Request) {
    switch ($Command) {
        'list' { return Get-ListSnapshot }
        'default' { return Get-DefaultSnapshot ([string]$Request.kind) }
        'set' {
            $allRoles = $true
            if ($null -ne $Request.allRoles) { $allRoles = [bool]$Request.allRoles }
            return Set-Device ([string]$Request.kind) ([string]$Request.deviceId) $allRoles
        }
        'selftest' { return Invoke-SelfTest }
        default { throw "Unknown command: $Command" }
    }
}

$isJsonl = $script:ArgList -contains '--jsonl'

if ($isJsonl) {
    Write-Json @{ ready = $true }
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $requestId = ''
        try {
            $request = $line | ConvertFrom-Json
            $requestId = [string]$request.id
            $data = Invoke-AudioCommand ([string]$request.command) $request
            $response = @{ id = $requestId; ok = $true }
            if ($data -is [hashtable]) {
                foreach ($key in $data.Keys) { $response[$key] = $data[$key] }
            }
            Write-Json $response
        } catch {
            Write-Failure $_.Exception.Message $requestId
        }
    }
    exit 0
}

$oneShotCommand = 'list'
if ($script:ArgList.Count -gt 0) {
    $first = [string]$script:ArgList[0]
    if (-not $first.StartsWith('--')) { $oneShotCommand = $first.ToLowerInvariant() }
}

$oneShotRequest = @{
    kind = Get-Option 'kind'
    deviceId = Get-Option 'id'
    allRoles = Convert-TextBool (Get-Option 'all-roles') $true
}

try {
    $data = Invoke-AudioCommand $oneShotCommand $oneShotRequest
    $response = @{ ok = $true }
    if ($data -is [hashtable]) {
        foreach ($key in $data.Keys) { $response[$key] = $data[$key] }
    }
    Write-Json $response
    exit 0
} catch {
    Write-Failure $_.Exception.Message
    exit 1
}
