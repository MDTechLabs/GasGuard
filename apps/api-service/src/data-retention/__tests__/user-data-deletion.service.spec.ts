import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { NotFoundException } from "@nestjs/common";
import { UserDataDeletionService } from "../services/user-data-deletion.service";
import { User } from "../../database/entities/user.entity";
import { AnalysisResult } from "../../database/entities/analysis-result.entity";

describe("UserDataDeletionService", () => {
  let service: UserDataDeletionService;
  let userRepo: Repository<User>;
  let analysisResultRepo: Repository<AnalysisResult>;

  const mockUserRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockAnalysisResultRepo = {
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDataDeletionService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: getRepositoryToken(AnalysisResult),
          useValue: mockAnalysisResultRepo,
        },
      ],
    }).compile();

    service = module.get<UserDataDeletionService>(UserDataDeletionService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    analysisResultRepo = module.get<Repository<AnalysisResult>>(
      getRepositoryToken(AnalysisResult),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("anonymizeUser", () => {
    it("should anonymize user successfully", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        firstName: "John",
        lastName: "Doe",
        passwordHash: "hash123",
        lastLoginIp: "127.0.0.1",
        isActive: true,
      } as User;

      mockUserRepo.findOne.mockResolvedValue(mockUser);
      mockUserRepo.save.mockImplementation(async (u) => u);

      const result = await service.anonymizeUser("user-123");

      expect(result).toEqual({ userId: "user-123" });
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: "user-123" },
      });
      expect(mockUserRepo.save).toHaveBeenCalled();

      // Check fields were overwritten
      const savedUser = mockUserRepo.save.mock.calls[0][0];
      expect(savedUser.email).toMatch(/deleted-.*@anonymized.invalid/);
      expect(savedUser.firstName).toBeUndefined();
      expect(savedUser.lastName).toBeUndefined();
      expect(savedUser.passwordHash).not.toBe("hash123");
      expect(savedUser.lastLoginIp).toBeUndefined();
      expect(savedUser.isActive).toBe(false);
    });

    it("should throw NotFoundException if user not found", async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.anonymizeUser("not-found")).rejects.toThrow(
        NotFoundException,
      );
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: "not-found" },
      });
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("purgeAnalysisResultsForMerchant", () => {
    it("should purge results successfully", async () => {
      mockAnalysisResultRepo.delete.mockResolvedValue({ affected: 3 });

      const result = await service.purgeAnalysisResultsForMerchant("merchant-123");

      expect(result).toEqual({ merchantId: "merchant-123", deleted: 3 });
      expect(mockAnalysisResultRepo.delete).toHaveBeenCalledWith({
        merchantId: "merchant-123",
      });
    });

    it("should handle 0 affected gracefully", async () => {
      mockAnalysisResultRepo.delete.mockResolvedValue({});

      const result = await service.purgeAnalysisResultsForMerchant("merchant-123");

      expect(result).toEqual({ merchantId: "merchant-123", deleted: 0 });
    });
  });
});
