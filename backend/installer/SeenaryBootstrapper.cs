using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using WinForms = System.Windows.Forms;

[assembly: AssemblyTitle("Seenary Setup")]
[assembly: AssemblyProduct("Seenary")]
[assembly: AssemblyCompany("Dainius Genzuras")]
[assembly: AssemblyDescription("Seenary desktop installer")]

namespace SeenaryInstaller
{
    internal static class Program
    {
        internal const int CancelledExitCode = -2;

        private static readonly object InstallerProcessSync = new object();
        private static Process activeInstallerProcess;
        private static bool installerCancellationRequested;

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                SetProcessDPIAware();

                if (HasSilentArgument(args))
                {
                    Environment.Exit(RunEmbeddedInstaller(args, false));
                    return;
                }

                var application = new Application
                {
                    ShutdownMode = ShutdownMode.OnMainWindowClose
                };
                application.Run(new InstallerWindow());
            }
            catch (Exception error)
            {
                var logPath = Path.Combine(
                    Path.GetTempPath(),
                    "SeenaryInstaller-error.log");
                try
                {
                    File.WriteAllText(logPath, error.ToString());
                }
                catch
                {
                    // Preserve the original installer failure if logging is unavailable.
                }

                MessageBox.Show(
                    "The Seenary installer could not open. Details were saved to "
                        + logPath,
                    "Seenary installer",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
        }

        internal static int RunEmbeddedInstaller(string[] args, bool forceAllUsers)
        {
            var workDirectory = Path.Combine(
                Path.GetTempPath(),
                "SeenaryInstaller",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(workDirectory);

            var installerPath = Path.Combine(workDirectory, "SeenarySetupCore.exe");

            try
            {
                using (var resource = Assembly.GetExecutingAssembly()
                    .GetManifestResourceStream("Seenary.CoreInstaller"))
                {
                    if (resource == null)
                    {
                        throw new InvalidOperationException("The Seenary installer payload is missing.");
                    }

                    using (var output = File.Create(installerPath))
                    {
                        resource.CopyTo(output);
                    }
                }

                var arguments = args == null || args.Length == 0
                    ? "/S"
                    : string.Join(" ", args);
                if (arguments.IndexOf("/S", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    arguments = "/S " + arguments;
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = installerPath,
                    Arguments = arguments,
                    UseShellExecute = true,
                    WorkingDirectory = workDirectory
                };

                if (forceAllUsers)
                {
                    startInfo.Verb = "runas";
                }

                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        throw new InvalidOperationException("Windows could not start the installer.");
                    }

                    lock (InstallerProcessSync)
                    {
                        activeInstallerProcess = process;
                        if (installerCancellationRequested)
                        {
                            TryStopInstaller(process);
                        }
                    }

                    process.WaitForExit();

                    lock (InstallerProcessSync)
                    {
                        activeInstallerProcess = null;
                        return installerCancellationRequested
                            ? CancelledExitCode
                            : process.ExitCode;
                    }
                }
            }
            catch
            {
                lock (InstallerProcessSync)
                {
                    activeInstallerProcess = null;
                    return installerCancellationRequested ? CancelledExitCode : 1;
                }
            }
            finally
            {
                try
                {
                    Directory.Delete(workDirectory, true);
                }
                catch
                {
                    // Windows can briefly retain the elevated payload. The temp folder
                    // is uniquely named and can be cleaned by normal system maintenance.
                }
            }
        }

        internal static void ResetEmbeddedInstallerCancellation()
        {
            lock (InstallerProcessSync)
            {
                installerCancellationRequested = false;
            }
        }

        internal static void CancelEmbeddedInstaller()
        {
            lock (InstallerProcessSync)
            {
                installerCancellationRequested = true;
                TryStopInstaller(activeInstallerProcess);
            }
        }

        private static void TryStopInstaller(Process process)
        {
            if (process == null)
            {
                return;
            }

            try
            {
                if (!process.HasExited)
                {
                    process.Kill();
                }
            }
            catch
            {
                // The async completion path still treats this as a user cancellation
                // and will close cleanly if Windows finishes shutting down the child.
            }
        }

        private static bool HasSilentArgument(string[] args)
        {
            foreach (var argument in args)
            {
                if (string.Equals(argument, "/S", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(argument, "--updated", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
    }

    internal sealed class InstallerWindow : Window
    {
        private static readonly Brush Surface = BrushFrom("#111116");
        private static readonly Brush SurfaceRaised = BrushFrom("#1A1921");
        private static readonly Brush Border = BrushFrom("#34313F");
        private static readonly Brush TextPrimary = BrushFrom("#F7F5FB");
        private static readonly Brush TextMuted = BrushFrom("#A7A3AE");
        private static readonly Brush Violet = BrushFrom("#9D7CFF");
        private static readonly Brush VioletDark = BrushFrom("#7251DD");

        private readonly Grid root;
        private readonly Grid contentHost;
        private readonly StackPanel optionsPanel;
        private readonly Button optionsButton;
        private readonly Button primaryButton;
        private readonly Button currentUserButton;
        private readonly Button allUsersButton;
        private readonly CheckBox desktopShortcutCheck;
        private readonly TextBox folderTextBox;
        private readonly Border visualCard;
        private readonly Grid cancelConfirmationOverlay;
        private bool installForAllUsers;
        private bool optionsVisible;
        private bool isInstalling;
        private bool isCancelling;

        internal InstallerWindow()
        {
            Title = "Install Seenary";
            Width = 920;
            Height = 640;
            MinWidth = 920;
            MinHeight = 640;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Closing += HandleWindowClosing;

            var frame = new Border
            {
                Background = Surface,
                CornerRadius = new CornerRadius(24),
                BorderBrush = Border,
                BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect
                {
                    BlurRadius = 35,
                    ShadowDepth = 12,
                    Opacity = 0.48,
                    Color = Colors.Black
                },
                ClipToBounds = true
            };

            root = new Grid();
            frame.Child = root;
            Content = frame;

            root.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs eventArgs)
            {
                if (eventArgs.ButtonState == MouseButtonState.Pressed)
                {
                    DragMove();
                }
            };

            var artwork = CreateArtwork();
            root.Children.Add(artwork);

            var tint = new Border
            {
                Background = new LinearGradientBrush(
                    Color.FromArgb(248, 17, 17, 22),
                    Color.FromArgb(118, 17, 17, 22),
                    new Point(0.2, 0.5),
                    new Point(1, 0.5))
            };
            root.Children.Add(tint);
            root.Children.Add(CreateWindowCloseButton());

            var shell = new Grid { Margin = new Thickness(67, 30, 67, 30) };
            shell.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            shell.RowDefinitions.Add(new RowDefinition());
            root.Children.Add(shell);

            shell.Children.Add(CreateTitleBar());

            contentHost = new Grid { Margin = new Thickness(0, 30, 0, 0) };
            Grid.SetRow(contentHost, 1);
            shell.Children.Add(contentHost);

            var installView = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            installView.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(480) });
            installView.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            contentHost.Children.Add(installView);

            var leftColumn = new Grid();
            installView.Children.Add(leftColumn);

            var copy = new StackPanel
            {
                Width = 450,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 18, 0, 0)
            };
            leftColumn.Children.Add(copy);

            copy.Children.Add(new TextBlock
            {
                Text = "Your anime and manga, together.",
                Foreground = TextPrimary,
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 30,
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 450
            });

            copy.Children.Add(new TextBlock
            {
                Text = "Install Seenary and keep your library, progress, discovery, and third-party sync in one comfortable desktop home.",
                Foreground = TextMuted,
                FontSize = 15,
                LineHeight = 23,
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 445,
                Margin = new Thickness(0, 14, 0, 20)
            });

            optionsButton = CreateTextButton("Options");
            optionsButton.HorizontalAlignment = HorizontalAlignment.Left;
            optionsButton.Click += ToggleOptions;
            copy.Children.Add(optionsButton);

            optionsPanel = new StackPanel
            {
                Visibility = Visibility.Collapsed,
                Margin = new Thickness(0, 12, 0, 0),
                MaxWidth = 450
            };
            copy.Children.Add(optionsPanel);

            optionsPanel.Children.Add(CreateSectionLabel("INSTALL FOR"));
            var scopeRow = new Grid { Margin = new Thickness(0, 8, 0, 14) };
            scopeRow.ColumnDefinitions.Add(new ColumnDefinition());
            scopeRow.ColumnDefinitions.Add(new ColumnDefinition());
            optionsPanel.Children.Add(scopeRow);

            currentUserButton = CreateChoiceButton(
                "Just me",
                "No administrator approval",
                "\uE77B");
            currentUserButton.Margin = new Thickness(0, 0, 6, 0);
            currentUserButton.Click += delegate { SelectScope(false); };
            scopeRow.Children.Add(currentUserButton);

            allUsersButton = CreateChoiceButton(
                "Everyone",
                "Available to every account",
                "\uE716");
            allUsersButton.Margin = new Thickness(6, 0, 0, 0);
            allUsersButton.Click += delegate { SelectScope(true); };
            Grid.SetColumn(allUsersButton, 1);
            scopeRow.Children.Add(allUsersButton);

            optionsPanel.Children.Add(CreateSectionLabel("INSTALL LOCATION"));
            var folderRow = new Grid { Margin = new Thickness(0, 8, 0, 12) };
            folderRow.ColumnDefinitions.Add(new ColumnDefinition());
            folderRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            optionsPanel.Children.Add(folderRow);

            folderTextBox = new TextBox
            {
                Text = DefaultInstallFolder(false),
                Height = 40,
                Padding = new Thickness(12, 9, 12, 8),
                Foreground = TextPrimary,
                Background = SurfaceRaised,
                BorderBrush = Border,
                BorderThickness = new Thickness(1),
                FontSize = 13
            };
            folderRow.Children.Add(folderTextBox);

            var browseButton = CreateSecondaryButton("Browse");
            browseButton.Margin = new Thickness(8, 0, 0, 0);
            browseButton.Click += ChooseFolder;
            Grid.SetColumn(browseButton, 1);
            folderRow.Children.Add(browseButton);

            desktopShortcutCheck = new CheckBox
            {
                Content = "Create a desktop shortcut",
                IsChecked = true,
                Foreground = TextMuted,
                FontSize = 13,
                VerticalContentAlignment = VerticalAlignment.Center,
                Template = CreateCheckboxTemplate(),
                Cursor = Cursors.Hand
            };
            optionsPanel.Children.Add(desktopShortcutCheck);

            var actionPanel = new StackPanel
            {
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 0, 10)
            };
            leftColumn.Children.Add(actionPanel);

            primaryButton = CreatePrimaryButton("Install Seenary");
            primaryButton.Click += InstallSeenary;
            actionPanel.Children.Add(primaryButton);

            actionPanel.Children.Add(new TextBlock
            {
                Text = "Windows may ask for approval when installing for everyone.",
                Foreground = BrushFrom("#77727F"),
                FontSize = 11,
                Margin = new Thickness(2, 10, 0, 0)
            });

            visualCard = CreateFeatureCard();
            Grid.SetRowSpan(visualCard, 2);
            shell.Children.Add(visualCard);

            var existingMachineInstall = File.Exists(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Seenary", "Seenary.exe"));
            SelectScope(existingMachineInstall);

            cancelConfirmationOverlay = CreateCancelInstallationOverlay();
            root.Children.Add(cancelConfirmationOverlay);
        }

        private Grid CreateTitleBar()
        {
            var titleBar = new Grid { Height = 48 };

            var identity = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };
            titleBar.Children.Add(identity);

            var icon = CreateResourceImage("Seenary.AppIcon");
            icon.Width = 34;
            icon.Height = 34;
            icon.Margin = new Thickness(0, 0, 12, 0);
            identity.Children.Add(icon);

            identity.Children.Add(new TextBlock
            {
                Text = "Seenary",
                Foreground = TextPrimary,
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 20,
                VerticalAlignment = VerticalAlignment.Center
            });

            return titleBar;
        }

        private Button CreateWindowCloseButton()
        {
            var close = CreateTextButton("×");
            close.Width = 42;
            close.Height = 38;
            close.FontSize = 26;
            close.Foreground = TextMuted;
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.VerticalAlignment = VerticalAlignment.Top;
            close.Margin = new Thickness(0, 18, 20, 0);
            close.Click += HandleCloseRequested;
            Panel.SetZIndex(close, 2);
            return close;
        }

        private Grid CreateCancelInstallationOverlay()
        {
            var overlay = new Grid
            {
                Background = BrushFrom("#C4000000"),
                Visibility = Visibility.Collapsed
            };
            Panel.SetZIndex(overlay, 10);

            var dialog = new Border
            {
                Width = 500,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Background = SurfaceRaised,
                BorderBrush = BrushFrom("#4B4658"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(22),
                Padding = new Thickness(30),
                Effect = new DropShadowEffect
                {
                    BlurRadius = 32,
                    ShadowDepth = 10,
                    Opacity = 0.55,
                    Color = Colors.Black
                }
            };
            overlay.Children.Add(dialog);

            var content = new StackPanel();
            dialog.Child = content;
            content.Children.Add(new TextBlock
            {
                Text = "Cancel installation?",
                Foreground = TextPrimary,
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 26
            });
            content.Children.Add(new TextBlock
            {
                Text = "Seenary is still being installed. Cancelling now will stop setup and may leave partial app files that Windows can safely replace the next time you install.",
                Foreground = TextMuted,
                FontSize = 14,
                LineHeight = 21,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 12, 0, 26)
            });

            var actions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right
            };
            content.Children.Add(actions);

            var keepInstalling = CreateSecondaryButton("Keep installing");
            keepInstalling.Height = 44;
            keepInstalling.Click += delegate
            {
                cancelConfirmationOverlay.Visibility = Visibility.Collapsed;
            };
            actions.Children.Add(keepInstalling);

            var cancelInstallation = CreatePrimaryButton("Cancel installation");
            cancelInstallation.Height = 44;
            cancelInstallation.MinWidth = 164;
            cancelInstallation.Margin = new Thickness(12, 0, 0, 0);
            cancelInstallation.Background = new LinearGradientBrush(
                Color.FromRgb(190, 61, 82),
                Color.FromRgb(135, 38, 57),
                0);
            cancelInstallation.BorderBrush = BrushFrom("#E57A8C");
            cancelInstallation.Click += delegate
            {
                isCancelling = true;
                cancelConfirmationOverlay.Visibility = Visibility.Collapsed;
                ShowCancelling();
                Program.CancelEmbeddedInstaller();
            };
            actions.Children.Add(cancelInstallation);

            return overlay;
        }

        private void HandleCloseRequested(object sender, RoutedEventArgs eventArgs)
        {
            if (!isInstalling)
            {
                Close();
                return;
            }

            if (!isCancelling)
            {
                cancelConfirmationOverlay.Visibility = Visibility.Visible;
            }
        }

        private void HandleWindowClosing(
            object sender,
            System.ComponentModel.CancelEventArgs eventArgs)
        {
            if (!isInstalling)
            {
                return;
            }

            eventArgs.Cancel = true;
            if (!isCancelling)
            {
                cancelConfirmationOverlay.Visibility = Visibility.Visible;
            }
        }

        private Border CreateFeatureCard()
        {
            var card = new Border
            {
                Width = 292,
                Height = 390,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
                Background = new LinearGradientBrush(
                    Color.FromArgb(205, 31, 28, 49),
                    Color.FromArgb(215, 18, 18, 25),
                    90),
                BorderBrush = BrushFrom("#4B416A"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(22),
                Padding = new Thickness(24)
            };

            var cardContent = new Grid();
            cardContent.RowDefinitions.Add(new RowDefinition());
            cardContent.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            card.Child = cardContent;

            var preview = new StackPanel { VerticalAlignment = VerticalAlignment.Top };
            preview.Children.Add(new TextBlock
            {
                Text = "YOUR LIBRARY",
                Foreground = BrushFrom("#77727F"),
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 9,
                Margin = new Thickness(2, 0, 0, 10)
            });
            preview.Children.Add(CreateMiniLibraryRow("#9D7CFF", 0, 112, 72));
            preview.Children.Add(CreateMiniLibraryRow("#4F7CFF", 14, 92, 126));
            preview.Children.Add(CreateMiniLibraryRow("#64D8A4", 0, 128, 84));
            cardContent.Children.Add(preview);

            var stack = new StackPanel();
            Grid.SetRow(stack, 1);
            cardContent.Children.Add(stack);

            stack.Children.Add(new TextBlock
            {
                Text = "A calmer way to track",
                Foreground = TextPrimary,
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 19,
                TextWrapping = TextWrapping.Wrap
            });
            stack.Children.Add(new TextBlock
            {
                Text = "Anime and Manga • Personal discovery • AniList and MyAnimeList sync",
                Foreground = TextMuted,
                FontSize = 12,
                LineHeight = 19,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 11, 0, 0)
            });

            return card;
        }

        private static Border CreateMiniLibraryRow(
            string accent,
            double leftMargin,
            double titleWidth,
            double metaWidth)
        {
            var row = new Border
            {
                Height = 52,
                Margin = new Thickness(leftMargin, 0, 0, 9),
                Background = BrushFrom("#201E28"),
                BorderBrush = BrushFrom("#3A3549"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(11),
                Padding = new Thickness(9)
            };

            var layout = new Grid();
            layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
            layout.ColumnDefinitions.Add(new ColumnDefinition());
            row.Child = layout;

            layout.Children.Add(new Border
            {
                Width = 28,
                Height = 34,
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = new LinearGradientBrush(
                    ((SolidColorBrush)BrushFrom(accent)).Color,
                    Color.FromArgb(255, 38, 34, 54),
                    45),
                CornerRadius = new CornerRadius(7)
            });

            var lines = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0)
            };
            Grid.SetColumn(lines, 1);
            layout.Children.Add(lines);
            lines.Children.Add(new Border
            {
                Width = titleWidth,
                Height = 6,
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = BrushFrom("#DDD8E7"),
                CornerRadius = new CornerRadius(3)
            });
            lines.Children.Add(new Border
            {
                Width = metaWidth,
                Height = 5,
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = BrushFrom("#625D6C"),
                CornerRadius = new CornerRadius(3),
                Margin = new Thickness(0, 7, 0, 0)
            });
            return row;
        }

        private Image CreateArtwork()
        {
            var image = CreateResourceImage("Seenary.InstallerArt");
            image.Stretch = Stretch.UniformToFill;
            image.HorizontalAlignment = HorizontalAlignment.Right;
            image.Width = 610;
            image.Opacity = 0.82;
            return image;
        }

        private static Image CreateResourceImage(string resourceName)
        {
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
            if (stream == null)
            {
                return new Image();
            }

            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            stream.Dispose();
            return new Image { Source = bitmap };
        }

        private void ToggleOptions(object sender, RoutedEventArgs eventArgs)
        {
            optionsVisible = !optionsVisible;
            optionsPanel.Visibility = optionsVisible ? Visibility.Visible : Visibility.Collapsed;
            optionsButton.Content = optionsVisible ? "Hide options" : "Options";
        }

        private void SelectScope(bool allUsers)
        {
            installForAllUsers = allUsers;
            StyleChoice(currentUserButton, !allUsers);
            StyleChoice(allUsersButton, allUsers);
            folderTextBox.Text = DefaultInstallFolder(allUsers);
        }

        private static void StyleChoice(Button button, bool selected)
        {
            button.Background = selected ? BrushFrom("#302943") : SurfaceRaised;
            button.BorderBrush = selected ? Violet : Border;
        }

        private void ChooseFolder(object sender, RoutedEventArgs eventArgs)
        {
            using (var dialog = new WinForms.FolderBrowserDialog())
            {
                dialog.Description = "Choose where Seenary should be installed.";
                dialog.SelectedPath = Directory.Exists(folderTextBox.Text)
                    ? folderTextBox.Text
                    : Path.GetDirectoryName(folderTextBox.Text);

                if (dialog.ShowDialog() == WinForms.DialogResult.OK)
                {
                    folderTextBox.Text = Path.Combine(dialog.SelectedPath, "Seenary");
                }
            }
        }

        private async void InstallSeenary(object sender, RoutedEventArgs eventArgs)
        {
            var destination = folderTextBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(destination) || !Path.IsPathRooted(destination))
            {
                ShowError("Choose a valid Windows installation folder.");
                return;
            }

            Program.ResetEmbeddedInstallerCancellation();
            isInstalling = true;
            isCancelling = false;
            ShowProgress();

            var arguments = "/S "
                + (installForAllUsers ? "/allusers" : "/currentuser");
            if (desktopShortcutCheck.IsChecked != true)
            {
                arguments += " --no-desktop-shortcut";
            }
            arguments += " /D=" + destination;

            var exitCode = await Task.Run(delegate
            {
                return Program.RunEmbeddedInstaller(new[] { arguments }, installForAllUsers);
            });

            isInstalling = false;
            if (isCancelling || exitCode == Program.CancelledExitCode)
            {
                Close();
                return;
            }

            if (exitCode == 0)
            {
                ShowSuccess(destination);
            }
            else
            {
                ShowFailure(exitCode);
            }
        }

        private void ShowCancelling()
        {
            var view = CreateStateView(
                "Cancelling installation",
                "Stopping Seenary setup and closing the installer safely.");

            view.Children.Add(new ProgressBar
            {
                IsIndeterminate = true,
                Height = 12,
                Width = 560,
                HorizontalAlignment = HorizontalAlignment.Left,
                Foreground = BrushFrom("#D86A7E"),
                Background = BrushFrom("#2B2932"),
                BorderThickness = new Thickness(0),
                Margin = new Thickness(0, 36, 0, 0)
            });
        }

        private void ShowProgress()
        {
            var view = CreateStateView(
                "Installing Seenary",
                "Setting up the app and preparing your library home. This usually takes only a moment.");

            var progress = new ProgressBar
            {
                IsIndeterminate = true,
                Height = 12,
                Width = 560,
                HorizontalAlignment = HorizontalAlignment.Left,
                Foreground = Violet,
                Background = BrushFrom("#2B2932"),
                BorderThickness = new Thickness(0),
                Margin = new Thickness(0, 36, 0, 0)
            };
            view.Children.Add(progress);

            var note = new TextBlock
            {
                Text = "Please keep this window open while Seenary is installed.",
                Foreground = BrushFrom("#77727F"),
                FontSize = 12,
                Margin = new Thickness(0, 18, 0, 0)
            };
            view.Children.Add(note);
        }

        private void ShowSuccess(string destination)
        {
            var view = CreateStateView(
                "Seenary is ready",
                "Installation finished successfully. Your existing Seenary library and settings are preserved.");

            var openButton = CreatePrimaryButton("Open Seenary");
            openButton.Margin = new Thickness(0, 30, 0, 0);
            openButton.Click += delegate
            {
                var appPath = Path.Combine(destination, "Seenary.exe");
                try
                {
                    if (!File.Exists(appPath))
                    {
                        throw new FileNotFoundException("The installed Seenary application was not found.");
                    }
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = appPath,
                        WorkingDirectory = destination,
                        UseShellExecute = true
                    });
                    Close();
                }
                catch (Exception)
                {
                    MessageBox.Show(
                        "Seenary was installed, but Windows could not open it. You can retry Open Seenary or launch it from the Start menu.",
                        "Seenary is installed", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            };
            view.Children.Add(openButton);

            var closeButton = CreateTextButton("Close installer");
            closeButton.HorizontalAlignment = HorizontalAlignment.Left;
            closeButton.Margin = new Thickness(8, 16, 0, 0);
            closeButton.Click += delegate { Close(); };
            view.Children.Add(closeButton);
        }

        private void ShowFailure(int exitCode)
        {
            var view = CreateStateView(
                "Installation did not finish",
                "Seenary could not be installed. Nothing was removed from your existing library.");

            view.Children.Add(new TextBlock
            {
                Text = "Installer result: " + exitCode,
                Foreground = BrushFrom("#FF9AAA"),
                FontSize = 12,
                Margin = new Thickness(0, 18, 0, 0)
            });

            var closeButton = CreateSecondaryButton("Close");
            closeButton.Margin = new Thickness(0, 28, 0, 0);
            closeButton.Click += delegate { Close(); };
            view.Children.Add(closeButton);
        }

        private void ShowError(string message)
        {
            MessageBox.Show(this, message, "Seenary installer", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        private StackPanel CreateStateView(string title, string description)
        {
            contentHost.Children.Clear();
            visualCard.Visibility = Visibility.Collapsed;
            var view = new StackPanel
            {
                Width = 560,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(26, 0, 0, 20)
            };
            contentHost.Children.Add(view);

            view.Children.Add(new TextBlock
            {
                Text = title,
                Foreground = TextPrimary,
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 32
            });
            view.Children.Add(new TextBlock
            {
                Text = description,
                Foreground = TextMuted,
                FontSize = 15,
                LineHeight = 23,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 14, 0, 0)
            });
            return view;
        }

        private static Button CreatePrimaryButton(string text)
        {
            return new Button
            {
                Content = text,
                MinWidth = 176,
                Height = 48,
                Padding = new Thickness(22, 0, 22, 0),
                HorizontalAlignment = HorizontalAlignment.Left,
                Foreground = Brushes.White,
                Background = new LinearGradientBrush(
                    ((SolidColorBrush)Violet).Color,
                    ((SolidColorBrush)VioletDark).Color,
                    0),
                BorderBrush = BrushFrom("#B49AFF"),
                BorderThickness = new Thickness(1),
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 14,
                Template = CreateButtonTemplate(13),
                Cursor = Cursors.Hand
            };
        }

        private static Button CreateSecondaryButton(string text)
        {
            return new Button
            {
                Content = text,
                Height = 40,
                MinWidth = 84,
                Padding = new Thickness(16, 0, 16, 0),
                Foreground = TextPrimary,
                Background = SurfaceRaised,
                BorderBrush = Border,
                BorderThickness = new Thickness(1),
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 12,
                Template = CreateButtonTemplate(10),
                Cursor = Cursors.Hand
            };
        }

        private static Button CreateTextButton(string text)
        {
            return new Button
            {
                Content = text,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Foreground = Violet,
                Padding = new Thickness(0),
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 13,
                Template = CreateButtonTemplate(8),
                Cursor = Cursors.Hand
            };
        }

        private static Button CreateChoiceButton(
            string title,
            string subtitle,
            string iconGlyph)
        {
            var content = new Grid { Margin = new Thickness(8, 6, 8, 6) };
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
            content.ColumnDefinitions.Add(new ColumnDefinition());

            content.Children.Add(new TextBlock
            {
                Text = iconGlyph,
                Foreground = BrushFrom("#D8D2E2"),
                FontFamily = new FontFamily("Segoe Fluent Icons"),
                FontSize = 19,
                Width = 28,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Left,
                TextAlignment = TextAlignment.Center
            });

            var copy = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(copy, 1);
            content.Children.Add(copy);
            copy.Children.Add(new TextBlock
            {
                Text = title,
                Foreground = TextPrimary,
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 13
            });
            copy.Children.Add(new TextBlock
            {
                Text = subtitle,
                Foreground = TextMuted,
                FontSize = 10,
                Margin = new Thickness(0, 3, 0, 0)
            });

            return new Button
            {
                Content = content,
                Height = 60,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Background = SurfaceRaised,
                BorderBrush = Border,
                BorderThickness = new Thickness(1),
                Template = CreateButtonTemplate(12),
                Cursor = Cursors.Hand
            };
        }

        private static ControlTemplate CreateButtonTemplate(double radius)
        {
            var border = new FrameworkElementFactory(typeof(Border));
            border.SetBinding(System.Windows.Controls.Border.BackgroundProperty, new System.Windows.Data.Binding("Background")
            {
                RelativeSource = new System.Windows.Data.RelativeSource(
                    System.Windows.Data.RelativeSourceMode.TemplatedParent)
            });
            border.SetBinding(System.Windows.Controls.Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush")
            {
                RelativeSource = new System.Windows.Data.RelativeSource(
                    System.Windows.Data.RelativeSourceMode.TemplatedParent)
            });
            border.SetBinding(System.Windows.Controls.Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness")
            {
                RelativeSource = new System.Windows.Data.RelativeSource(
                    System.Windows.Data.RelativeSourceMode.TemplatedParent)
            });
            border.SetValue(System.Windows.Controls.Border.CornerRadiusProperty, new CornerRadius(radius));

            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetBinding(
                ContentPresenter.HorizontalAlignmentProperty,
                new System.Windows.Data.Binding("HorizontalContentAlignment")
                {
                    RelativeSource = new System.Windows.Data.RelativeSource(
                        System.Windows.Data.RelativeSourceMode.TemplatedParent)
                });
            content.SetBinding(
                ContentPresenter.VerticalAlignmentProperty,
                new System.Windows.Data.Binding("VerticalContentAlignment")
                {
                    RelativeSource = new System.Windows.Data.RelativeSource(
                        System.Windows.Data.RelativeSourceMode.TemplatedParent)
                });
            content.SetBinding(ContentPresenter.MarginProperty, new System.Windows.Data.Binding("Padding")
            {
                RelativeSource = new System.Windows.Data.RelativeSource(
                    System.Windows.Data.RelativeSourceMode.TemplatedParent)
            });
            content.SetBinding(ContentPresenter.ContentProperty, new System.Windows.Data.Binding("Content")
            {
                RelativeSource = new System.Windows.Data.RelativeSource(
                    System.Windows.Data.RelativeSourceMode.TemplatedParent)
            });
            border.AppendChild(content);

            var template = new ControlTemplate(typeof(Button)) { VisualTree = border };
            var hover = new Trigger { Property = Button.IsMouseOverProperty, Value = true };
            hover.Setters.Add(new Setter(UIElement.OpacityProperty, 0.88));
            template.Triggers.Add(hover);
            var pressed = new Trigger { Property = Button.IsPressedProperty, Value = true };
            pressed.Setters.Add(new Setter(UIElement.OpacityProperty, 0.72));
            template.Triggers.Add(pressed);
            return template;
        }

        private static ControlTemplate CreateCheckboxTemplate()
        {
            var layout = new FrameworkElementFactory(typeof(StackPanel));
            layout.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);
            layout.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);

            var box = new FrameworkElementFactory(typeof(Border));
            box.Name = "CheckBoxSurface";
            box.SetValue(FrameworkElement.WidthProperty, 19.0);
            box.SetValue(FrameworkElement.HeightProperty, 19.0);
            box.SetValue(System.Windows.Controls.Border.CornerRadiusProperty, new CornerRadius(5));
            box.SetValue(System.Windows.Controls.Border.BackgroundProperty, BrushFrom("#17161C"));
            box.SetValue(System.Windows.Controls.Border.BorderBrushProperty, BrushFrom("#4A4652"));
            box.SetValue(System.Windows.Controls.Border.BorderThicknessProperty, new Thickness(1));

            var glyph = new FrameworkElementFactory(typeof(TextBlock));
            glyph.Name = "CheckGlyph";
            glyph.SetValue(TextBlock.TextProperty, "✓");
            glyph.SetValue(TextBlock.ForegroundProperty, Violet);
            glyph.SetValue(TextBlock.FontFamilyProperty, new FontFamily("Segoe UI Semibold"));
            glyph.SetValue(TextBlock.FontSizeProperty, 14.0);
            glyph.SetValue(TextBlock.TextAlignmentProperty, TextAlignment.Center);
            glyph.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            glyph.SetValue(UIElement.VisibilityProperty, Visibility.Collapsed);
            box.AppendChild(glyph);
            layout.AppendChild(box);

            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(FrameworkElement.MarginProperty, new Thickness(9, 0, 0, 0));
            content.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            content.SetBinding(ContentPresenter.ContentProperty, new System.Windows.Data.Binding("Content")
            {
                RelativeSource = new System.Windows.Data.RelativeSource(
                    System.Windows.Data.RelativeSourceMode.TemplatedParent)
            });
            layout.AppendChild(content);

            var template = new ControlTemplate(typeof(CheckBox)) { VisualTree = layout };
            var checkedTrigger = new Trigger
            {
                Property = ToggleButton.IsCheckedProperty,
                Value = true
            };
            checkedTrigger.Setters.Add(new Setter(
                UIElement.VisibilityProperty,
                Visibility.Visible,
                "CheckGlyph"));
            checkedTrigger.Setters.Add(new Setter(
                System.Windows.Controls.Border.BackgroundProperty,
                BrushFrom("#29223A"),
                "CheckBoxSurface"));
            checkedTrigger.Setters.Add(new Setter(
                System.Windows.Controls.Border.BorderBrushProperty,
                Violet,
                "CheckBoxSurface"));
            template.Triggers.Add(checkedTrigger);

            var hoverTrigger = new Trigger
            {
                Property = UIElement.IsMouseOverProperty,
                Value = true
            };
            hoverTrigger.Setters.Add(new Setter(
                System.Windows.Controls.Border.BorderBrushProperty,
                BrushFrom("#B59EFF"),
                "CheckBoxSurface"));
            template.Triggers.Add(hoverTrigger);
            return template;
        }

        private static TextBlock CreateSectionLabel(string text)
        {
            return new TextBlock
            {
                Text = text,
                Foreground = BrushFrom("#77727F"),
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 10
            };
        }

        private static string DefaultInstallFolder(bool allUsers)
        {
            var root = allUsers
                ? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)
                : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return allUsers
                ? Path.Combine(root, "Seenary")
                : Path.Combine(root, "Programs", "Seenary");
        }

        private static SolidColorBrush BrushFrom(string hex)
        {
            var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(hex);
            brush.Freeze();
            return brush;
        }
    }
}
