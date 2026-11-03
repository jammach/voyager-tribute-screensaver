// Voyager screen saver host: a WinForms shell around a WebView2 control that renders the WebGL tour.
// Build with the .NET Framework C# compiler (C# 5), x64.
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [STAThread]
    static int Main(string[] args)
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }

        // Windows passes /s (run), /c[:hwnd] (configure), /p <hwnd> (preview)
        string mode = "/c";
        if (args.Length > 0)
        {
            string a = args[0].Trim().ToLowerInvariant().TrimStart('/', '-');
            if (a.Length > 0) mode = "/" + a.Substring(0, 1);
        }
        if (mode == "/p") return 0;     // no tiny preview; Windows shows a blank preview pane
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (mode == "/c")
        {
            MessageBox.Show("Voyager 1 & 2 — Grand Tour\r\n\r\nA real-time reconstruction of both Voyager flights: Jupiter, Saturn, Uranus and Neptune.\r\nNothing to configure. Move the mouse or press a key to exit.",
                            "Voyager screen saver", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        string webDir = FindWebDir();
        if (webDir == null)
        {
            MessageBox.Show("The Voyager 'web' folder was not found next to the screen saver.", "Voyager screen saver");
            return 1;
        }
        try { string v = CoreWebView2Environment.GetAvailableBrowserVersionString(); if (string.IsNullOrEmpty(v)) throw new Exception(); }
        catch (Exception)
        {
            MessageBox.Show("The Microsoft Edge WebView2 Runtime is required.\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703", "Voyager screen saver");
            return 1;
        }

        Screen primary = Screen.PrimaryScreen;
        foreach (Screen s in Screen.AllScreens)
        {
            Form f = (s.Equals(primary)) ? (Form)new SaverForm(s.Bounds, webDir) : new BlankForm(s.Bounds);
            f.Show();
        }
        // Focus-independent exit: poll the real keyboard/mouse state after a short grace period.
        Point basePos = Cursor.Position;
        uint lastInput = LastInputTick();
        DateTime armAt = DateTime.UtcNow.AddMilliseconds(2000);
        Timer poll = new Timer();
        poll.Interval = 80;
        poll.Tick += delegate
        {
            if (DateTime.UtcNow < armAt) { basePos = Cursor.Position; lastInput = LastInputTick(); return; }
            Point c = Cursor.Position;
            uint li = LastInputTick();
            if (li != lastInput) { lastInput = li; if (c == basePos) { Application.Exit(); return; } }   // input without cursor movement = key or button
            if (Math.Abs(c.X - basePos.X) + Math.Abs(c.Y - basePos.Y) > 30) { Application.Exit(); return; }
            for (int vk = 1; vk < 255; vk++)
            {
                if ((GetAsyncKeyState(vk) & 0x8000) != 0) { Application.Exit(); return; }
            }
        };
        poll.Start();
        Application.Run();
        return 0;
    }

    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
    static uint LastInputTick() { LASTINPUTINFO i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)); GetLastInputInfo(ref i); return i.dwTime; }

    static string FindWebDir()
    {
        string here = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
        if (File.Exists(Path.Combine(here, "index.html"))) return here;
        try
        {
            object p = Registry.GetValue(@"HKEY_CURRENT_USER\Software\VoyagerSaver", "Path", null);
            if (p != null) { string d = Path.Combine((string)p, "web"); if (File.Exists(Path.Combine(d, "index.html"))) return d; }
        }
        catch (Exception) { }
        return null;
    }
}

class BlankForm : Form
{
    Point start = Point.Empty;
    public BlankForm(Rectangle bounds)
    {
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; Bounds = bounds;
        BackColor = Color.Black; TopMost = true; ShowInTaskbar = false; Cursor.Hide();
        KeyDown += delegate { Application.Exit(); };
        MouseDown += delegate { Application.Exit(); };
        MouseMove += delegate (object s, MouseEventArgs e)
        {
            if (start == Point.Empty) { start = e.Location; return; }
            if (Math.Abs(e.X - start.X) + Math.Abs(e.Y - start.Y) > 25) Application.Exit();
        };
    }
}

class SaverForm : Form
{
    readonly WebView2 web = new WebView2();
    readonly string webDir;

    public SaverForm(Rectangle bounds, string webDir)
    {
        this.webDir = webDir;
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; Bounds = bounds;
        BackColor = Color.Black; TopMost = true; ShowInTaskbar = false; Cursor.Hide();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Black;
        Controls.Add(web);
        Shown += OnShown;
        KeyDown += delegate { Application.Exit(); };
    }

    async void OnShown(object sender, EventArgs e)
    {
        try
        {
            string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoyagerSaver", "webview");
            Directory.CreateDirectory(userData);
            CoreWebView2EnvironmentOptions opt = new CoreWebView2EnvironmentOptions("--ignore-gpu-blocklist --enable-gpu-rasterization --disable-features=CalculateNativeWinOcclusion --enable-zero-copy");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, opt);
            await web.EnsureCoreWebView2Async(env);
            CoreWebView2 core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsPinchZoomEnabled = false;
            core.SetVirtualHostNameToFolderMapping("voyager.local", webDir, CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += OnMessage;
            core.Navigate("https://voyager.local/index.html");
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "voyager_saver.log"), DateTime.Now + " init failed: " + ex + "\r\n"); } catch (Exception) { }
            Application.Exit();
        }
    }

    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string m = e.TryGetWebMessageAsString();
        if (m == "exit") { Application.Exit(); return; }
        if (m != null && m.StartsWith("log:"))
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "voyager_saver.log"), DateTime.Now.ToString("HH:mm:ss") + " " + m.Substring(4) + "\r\n"); } catch (Exception) { }
        }
    }
}
