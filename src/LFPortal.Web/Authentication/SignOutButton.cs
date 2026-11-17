using System.Security.Claims;

namespace LFPortal.Web.Authentication;

/// <summary>
/// The header's «تسجيل الخروج» button. Only a username / password sign-in (the
/// <c>/Login/Password</c> page) gets one; a Web Client (LFDS) sign-in keeps the header as before.
/// </summary>
public static class SignOutButton
{
    /// <summary>True for a signed-in account that signed in with a password.</summary>
    public static bool Shows(ClaimsPrincipal? user) =>
        user?.Identity?.IsAuthenticated == true &&
        user.FindFirstValue(ClaimTypes.AuthenticationMethod) ==
            DashboardAuthenticationDefaults.PasswordAuthenticationMethod;

    /// <summary>The account name as the portal knows it (without <c>@LFDS</c>).</summary>
    public static string Name(ClaimsPrincipal? user) =>
        PortalAccountName.FromSignIn(user?.Identity?.Name) ?? "";
}
