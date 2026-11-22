// Generate equally spaced stages of one paper sheet being compressed.
#include <algorithm>
#include <cmath>
#include <iostream>
#include <vector>

struct Vec {
    double x = 0, y = 0, z = 0;
    Vec operator+(Vec b) const { return {x+b.x, y+b.y, z+b.z}; }
    Vec operator-(Vec b) const { return {x-b.x, y-b.y, z-b.z}; }
    Vec operator*(double s) const { return {x*s, y*s, z*s}; }
    Vec& operator+=(Vec b) { return *this = *this + b; }
    double norm() const { return std::sqrt(x*x+y*y+z*z); }
};

constexpr int cols = 43, rows = 35, count = cols*rows;
constexpr int stageCount = 23, stepsPerStage = 14;
constexpr int grid = 52;
constexpr double contact = .072;
struct Link { int a, b; double length, strength; };

int main() {
    std::vector<Vec> positions(count), previous(count);
    std::vector<Link> links;
    std::vector<int> cells(grid*grid*grid), next(count), cellx(count), celly(count), cellz(count);
    for (int y = 0; y < rows; y++) {
        for (int x = 0; x < cols; x++) {
            const double u = (double)x/(cols-1)*2-1, v = (double)y/(rows-1)*2-1;
            positions[y*cols+x] = {
                u*1.61, v*1.255,
                .045*std::sin(4*u-1.4*v) + .069*std::cos(3.4*v+2*u) +
                .023*std::sin(14*u+7*v) + .011*std::sin(26*u-19*v)
            };
        }
    }
    previous = positions;
    const auto addLink = [&](int x, int y, int dx, int dy, double strength) {
        if (x+dx < 0 || x+dx >= cols || y+dy >= rows) return;
        int a = y*cols+x, b = (y+dy)*cols+x+dx;
        links.push_back({a,b,(positions[b]-positions[a]).norm(),strength});
    };
    for (int y = 0; y < rows; y++) for (int x = 0; x < cols; x++) {
        addLink(x,y,1,0,.84);
        addLink(x,y,0,1,.84);
        addLink(x,y,1,1,.70);
        addLink(x,y,-1,1,.70);
        addLink(x,y,2,0,.023);
        addLink(x,y,0,2,.023);
    }
    const auto gridCoord = [](double value) {
        return std::clamp((int)std::floor(value/contact)+grid/2, 1, grid-2);
    };
    const auto index = [](int x, int y, int z) { return (z*grid+y)*grid+x; };
    const auto emit = [&] {
        Vec center;
        for (Vec p : positions) center += p*(1.0/count);
        std::cout << '[';
        for (int i = 0; i < count; i++) {
            Vec p = positions[i]-center;
            if (i) std::cout << ',';
            std::cout << std::lround(p.x*8192) << ',' << std::lround(p.y*8192) << ',' << std::lround(p.z*8192);
        }
        std::cout << ']';
    };

    std::cout << "export const columns = " << cols << ";\nexport const rows = " << rows
              << ";\nexport const stages = [\n";
    emit();
    for (int step = 1; step <= stageCount*stepsPerStage; step++) {
        double t = (double)step / (stageCount*stepsPerStage);
        double compression = std::min(1.0, t/.91);
        double radius = 2.05 - 1.43*std::pow(compression,.73);
        // Off-center compression makes the folds buckle at different times.
        Vec center{.23*std::sin(5*t)*(1-t), -.15*std::sin(6*t)*(1-t), .30*std::sin(3*t)};
        for (int i = 0; i < count; i++) {
            Vec velocity = (positions[i]-previous[i])*.82;
            previous[i] = positions[i];
            double phase = i*.072;
            positions[i] += velocity + Vec{0,0,.00055*std::sin(phase+t*7)+.0003*std::sin(phase*3.71)};
        }
        for (int iteration = 0; iteration < 10; iteration++) {
            for (const auto &link : links) {
                Vec delta = positions[link.b]-positions[link.a];
                double distance = delta.norm();
                if (distance < .00001) continue;
                Vec correction = delta*((distance-link.length)/distance*link.strength*.5);
                positions[link.a] += correction;
                positions[link.b] += correction*(-1);
            }
            std::fill(cells.begin(),cells.end(),-1);
            for (int i = 0; i < count; i++) {
                Vec p = positions[i];
                cellx[i]=gridCoord(p.x);
                celly[i]=gridCoord(p.y);
                cellz[i]=gridCoord(p.z);
                int cell=index(cellx[i],celly[i],cellz[i]);
                next[i]=cells[cell];
                cells[cell]=i;
            }
            for (int i = 0; i < count; i++) {
                for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int cell=index(cellx[i]+dx,celly[i]+dy,cellz[i]+dz);
                    for (int j = cells[cell]; j > i; j = next[j]) {
                        if (std::abs(i%cols-j%cols)<=1 && std::abs(i/cols-j/cols)<=1) continue;
                        Vec delta=positions[j]-positions[i];
                        double distance=delta.norm();
                        if (distance >= contact || distance < .00001) continue;
                        Vec correction=delta*((contact-distance)/distance*.42);
                        positions[i] += correction*(-1);
                        positions[j] += correction;
                    }
                }
            }
            for (Vec &p : positions) {
                Vec d = p-center;
                Vec scaled{d.x, d.y*1.12, d.z*.96};
                double distance = scaled.norm();
                double shell = radius * (1 + .095*std::sin(d.x*5+d.z*8)*std::cos(d.y*7-d.z*3));
                if (distance > shell) p += d*((shell/distance-1)*.83);
            }
        }
        if (step%stepsPerStage == 0) {
            std::cout << ",\n";
            emit();
        }
    }
    std::cout << "\n];\n";
}
