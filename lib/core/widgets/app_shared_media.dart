part of 'app_shared.dart';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• Product imagery â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/// Renders a product photo from either a network URL or an inline data URL,
/// falling back to a lettered tile when there's no image. Shared by the Menu
/// grid and the Home page's featured / kitchen cards so image handling stays
/// in one place.
class ProductImage extends StatelessWidget {
  const ProductImage(this.product, {super.key, this.cacheWidth = 600});

  final Product product;
  final int? cacheWidth;

  @override
  Widget build(BuildContext context) {
    final url = product.imageUrl;
    final bytes = product.imageBytes;

    Widget fallback() => _LetterTile(name: product.name);

    if (url != null) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: cacheWidth,
        filterQuality: FilterQuality.medium,
        frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
          if (wasSynchronouslyLoaded || frame != null) {
            return child;
          }
          return const PlaceholderBox(radius: 12);
        },
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const PlaceholderBox(radius: 12),
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: cacheWidth,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return fallback();
  }
}

/// Opens [product]'s photo full-screen over a dimmed backdrop, pinch/drag
/// zoomable via [InteractiveViewer]. Tapping the backdrop or the image
/// dismisses it. No-ops when the product has no photo to show.
void showProductImageViewer(BuildContext context, Product product) {
  if (product.imageUrl == null && product.imageBytes == null) return;
  Navigator.of(context).push(
    PageRouteBuilder(
      opaque: false,
      barrierColor: Colors.black87,
      pageBuilder: (context, animation, secondaryAnimation) {
        return FadeTransition(
          opacity: animation,
          child: GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: Scaffold(
              backgroundColor: Colors.transparent,
              body: SafeArea(
                child: Stack(
                  children: [
                    Center(
                      child: InteractiveViewer(
                        maxScale: 4,
                        child: ProductImage(product, cacheWidth: null),
                      ),
                    ),
                    Positioned(
                      top: AppSpacing.sm,
                      right: AppSpacing.sm,
                      child: IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(
                          Icons.close_rounded,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    ),
  );
}

/// Cover-fit image for a [CateringPackage] (remote URL or inline data URL),
/// with a branded letter-tile fallback. Mirrors [ProductImage].
class PackageImage extends StatelessWidget {
  const PackageImage(this.package, {super.key, this.cacheWidth = 600});

  final CateringPackage package;
  final int? cacheWidth;

  @override
  Widget build(BuildContext context) {
    final url = package.imageUrl;
    final bytes = package.imageBytes;

    Widget fallback() => _LetterTile(name: package.name);

    if (url != null) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: cacheWidth,
        filterQuality: FilterQuality.medium,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const PlaceholderBox(radius: 12),
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: cacheWidth,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return fallback();
  }
}

/// Cover-fit image for an [EventSetup] (remote URL or inline data URL), with a
/// branded letter-tile fallback. Mirrors [ProductImage].
class SetupImage extends StatelessWidget {
  const SetupImage(this.setup, {super.key, this.cacheWidth = 600});

  final EventSetup setup;
  final int? cacheWidth;

  @override
  Widget build(BuildContext context) {
    final url = setup.imageUrl;
    final bytes = setup.imageBytes;

    Widget fallback() => _LetterTile(name: setup.title);

    if (url != null) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: cacheWidth,
        filterQuality: FilterQuality.medium,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const PlaceholderBox(radius: 12),
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: cacheWidth,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return fallback();
  }
}

class _LetterTile extends StatelessWidget {
  const _LetterTile({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final letter = (name.trim().isEmpty ? '?' : name.trim()[0]).toUpperCase();
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: const RadialGradient(
          center: Alignment(-0.2, -0.3),
          radius: 1.1,
          colors: [AppColors.surface, AppColors.creamEdge],
        ),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Text(
        letter,
        style: AppTextStyles.serif(
          size: 40,
          color: AppColors.gold,
          weight: FontWeight.w700,
        ),
      ),
    );
  }
}
